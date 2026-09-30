/* =============================================================
   Haazri — which Firebase project this copy talks to

   PASTE YOUR FIREBASE CONFIG BELOW BEFORE PUTTING THIS ONLINE.

   Make a NEW Firebase project for Haazri (e.g. "haazri-app"). Do not
   point this at mirrorBill's project: the free Spark quota (50,000
   reads and 20,000 writes a day) is counted per project, and the two
   products would be eating the same allowance.

   Firebase console -> Project settings -> General -> "Your apps" ->
   add a Web app -> copy the config object over the one below. Then:
     - Authentication -> Sign-in method -> enable Email/Password
     - Firestore Database -> create (production mode, region
       asia-south1 for India)
     - deploy firestore.rules and firestore.indexes.json
       (firebase deploy --only firestore)

   These values are not secrets. Firebase web config is public by
   design; what protects each shop's data is the login and the rules
   in firestore.rules.

   emulator: true talks to the local Firebase emulators instead
   (npm run emulators) — for testing only.
   ============================================================= */
window.HAAZRI_CONFIG = {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },
  /* Staff logins are made-up addresses at this domain — nobody ever
     types or receives mail at it. It only has to look like an email to
     Firebase. Change it before the first shop signs up, never after:
     every staff login is built from it. */
  staffDomain: "staff.haazri.app",
  emulator: false
};

/* ?emu=1 on a localhost address switches to the emulators for that
   visit — the browser tests use it, and it can never reach a real
   deployment because it is refused on any other host. */
(function () {
  try {
    var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (local && /[?&]emu=1\b/.test(location.search)) {
      window.HAAZRI_CONFIG.emulator = true;
      if (!window.HAAZRI_CONFIG.firebase.apiKey) {
        window.HAAZRI_CONFIG.firebase = {
          apiKey: 'emulator-key', authDomain: 'localhost', projectId: 'haazri-test',
          appId: 'emulator'
        };
      }
    }
  } catch (e) {}
})();
