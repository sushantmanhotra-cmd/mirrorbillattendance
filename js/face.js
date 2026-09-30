/* =============================================================
   Haazri — recognising a face, on the phone that sees it

   Free by construction. The model is face-api (MIT), shipped inside the
   app under /vendor, and it runs on this device's own graphics chip.
   Nothing is sent anywhere to be matched, nothing is billed per scan,
   and there is no account with anybody to run out.

   Nothing here is loaded until somebody opens the kiosk or registers a
   face. The library and its three models come to about 8 MB, and a
   owner who only ever looks at the register has no business downloading that. On
   the one device that does use it, the files are named by version and
   kept forever — by the browser and by the service worker — so they
   come down once and not every morning.

   WHAT A MATCH MEANS

   The model turns a face into 128 numbers. Two pictures of the same
   person land close together; two different people land further apart.
   Measured on real portraits while building this: the same person on a
   different photo came out at 0.25, and the nearest two different
   people at 0.63.

   So a face is only accepted if it is within 0.40 of somebody, AND
   clearly nearer them than anybody else. The second rule is the one
   that matters in a shop: two sisters working the same floor are the
   case where a bare threshold marks the wrong one present, and the one
   who was not there gets paid.

   WHY 0.40, AND WHY "COME CLOSER"

   It was 0.5, and a shop registering its team was told a new
   employee's face "is already registered" to somebody else entirely.
   Measured afterwards on 25 people: with the face filling a good part
   of the picture, the same person scores about 0.16 and two different
   people never came under 0.48. With the face small in the frame —
   somebody standing back from a phone on a stand — the same person
   drifts up to 0.3 and beyond, and two different people came as close
   as 0.37. A small face is a blurry face, and blurry faces all look
   alike to the model.

   So three things together:
     - a face too small in the picture is not used at all, the person
       is asked to come closer (harder for registering than for the
       daily scan, because a poor registration spoils every morning
       after it);
     - the full landmark model (350 KB more than the tiny one) lines
       the face up better before it is measured — faces registered
       with the tiny one still match, measured at 0.18 for the same
       person;
     - 0.40 to accept, with a wider margin over the next person.
   ============================================================= */
window.Face = (function () {
  'use strict';

  var LIB = 'vendor/face-api-1.7.15.js';
  var MODELS = 'vendor/face-models';

  var MATCH = 0.40;     // further than this from everybody: not somebody we know
  var MARGIN = 0.08;    // nearest must beat the next person by this much
  /* Registering somebody who looks like a colleague is refused only when
     they are nearly certainly the same person. Between this and MATCH
     the two are allowed to be different people, and the margin above
     is what keeps the door from mixing them up. */
  var DUPLICATE = 0.32;
  /* How much of the picture's height the face must fill. */
  var CLOSE_TO_REGISTER = 0.35;
  var CLOSE_TO_SCAN = 0.28;

  var loading = null;
  var stream = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.faceapi) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load the face library')); };
      document.head.appendChild(s);
    });
  }

  /* Once per page. A second caller waits on the first rather than
     starting its own 8 MB download. */
  function ready(onStep) {
    if (loading) return loading;
    loading = loadScript(LIB).then(function () {
      if (onStep) onStep('Getting the face models ready…');
      /* The phone's graphics chip if it will have us, plain JavaScript if
         not. Chosen BEFORE the models load, because loading them already
         needs a backend — and on a phone whose browser refuses WebGL the
         library otherwise reaches for one it never set up and every scan
         fails with an error nobody can read. Slower on the CPU, but a
         scan a second late is still a scan. */
      var tf = faceapi.tf;
      if (!tf || !tf.setBackend) return null;
      return Promise.resolve(tf.setBackend('webgl')).catch(function () { return false; })
        .then(function (ok) { return ok ? ok : tf.setBackend('cpu'); })
        .then(function () { return tf.ready(); });
    }).then(function () {
      return Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODELS),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODELS),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODELS)
      ]);
    }).then(function () {
      return faceapi.tf && faceapi.tf.ready ? faceapi.tf.ready() : null;
    }).catch(function (e) {
      loading = null;   // let the next attempt try again rather than cache the failure
      throw e;
    });
    return loading;
  }

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* The front camera, because the person is looking at the screen. */
  function startCamera(video) {
    if (!supported()) {
      return Promise.reject(new Error('This device’s browser cannot open the camera'));
    }
    stopCamera();
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    }).then(function (s) {
      stream = s;
      video.srcObject = s;
      video.setAttribute('playsinline', '');   // iOS plays it inline, not full-screen
      video.muted = true;
      return video.play();
    });
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      stream = null;
    }
  }

  /* One face in the picture, or none. Two faces in frame is refused
     rather than guessed at: whichever one the model happened to pick
     is who would get marked.

     `share` is how much of the picture's height the face fills, for the
     caller to hold against CLOSE_TO_SCAN or CLOSE_TO_REGISTER. */
  function describe(input) {
    var opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
    var w = input.videoWidth || input.width || 0;
    var h = input.videoHeight || input.height || 0;
    return faceapi.detectAllFaces(input, opts)
      .withFaceLandmarks()
      .withFaceDescriptors()
      .then(function (all) {
        if (!all || !all.length) return { none: true };
        if (all.length > 1) return { many: all.length };
        var f = all[0];
        var side = Math.min(w, h) || 1;
        return {
          descriptor: Array.from(f.descriptor),
          box: f.detection.box,
          share: f.detection.box.height / side
        };
      });
  }

  function distance(a, b) {
    var n = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; n += d * d; }
    return Math.sqrt(n);
  }

  /* Who this is, if anybody. Pure arithmetic over what is stored, so it
     can be tested without a camera or a model — and it is the part that
     decides whose pay a scan lands on. */
  function match(descriptor, roster) {
    if (!descriptor || !roster || !roster.length) return { unknown: true };
    var scored = roster.map(function (p) {
      var best = Infinity;
      (p.samples || []).forEach(function (s) {
        if (s && s.length === descriptor.length) best = Math.min(best, distance(descriptor, s));
      });
      return { id: p.id, name: p.name, distance: best };
    }).sort(function (x, y) { return x.distance - y.distance; });

    var top = scored[0];
    if (!top || !(top.distance <= MATCH)) return { unknown: true, nearest: top };
    var next = scored[1];
    if (next && next.distance - top.distance < MARGIN) {
      return { ambiguous: true, between: [top, next] };
    }
    return { id: top.id, name: top.name, distance: top.distance };
  }

  /* One person, on their own phone.

     The kiosk asks "who is this, out of everybody". An employee scanning
     on their own phone is signed in already, so the question is smaller
     and stricter: "is this the person whose login this is". Only their
     own samples are compared, and there is no colleague to be confused
     with — a friend holding the phone up to their own face is simply
     not within MATCH of somebody else's samples. */
  function verify(descriptor, samples) {
    var best = Infinity;
    (samples || []).forEach(function (s) {
      if (s && s.length === descriptor.length) best = Math.min(best, distance(descriptor, s));
    });
    return { ok: best <= MATCH, distance: best };
  }

  /* A small picture of the moment for the owner's record. 64 px is
     enough for a person to recognise a colleague and small enough that
     a year of mornings is not a year of storage. */
  function thumb(video, box) {
    try {
      var c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      var x = c.getContext('2d');
      var sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
      if (box) {
        var pad = Math.max(box.width, box.height) * 0.35;
        var side = Math.max(box.width, box.height) + pad * 2;
        sx = Math.max(0, box.x + box.width / 2 - side / 2);
        sy = Math.max(0, box.y + box.height / 2 - side / 2);
        sw = sh = Math.min(side, video.videoWidth - sx, video.videoHeight - sy);
      }
      x.drawImage(video, sx, sy, sw, sh, 0, 0, 64, 64);
      return c.toDataURL('image/jpeg', 0.6);
    } catch (e) { return ''; }
  }

  return {
    ready: ready, supported: supported,
    startCamera: startCamera, stopCamera: stopCamera,
    describe: describe, match: match, verify: verify, distance: distance, thumb: thumb,
    MATCH: MATCH, MARGIN: MARGIN, DUPLICATE: DUPLICATE,
    CLOSE_TO_REGISTER: CLOSE_TO_REGISTER, CLOSE_TO_SCAN: CLOSE_TO_SCAN
  };
})();
