# What Haazri costs to run

**Short answer: ₹0 a month for 100 shops, and still ₹0 for 200 shops of 15
staff, though at that size you're close to the limit.** If you ever go
over, the overflow costs a few rupees a month, not thousands.

Here's why, and the numbers behind it.

## The two expensive things, and why they're free here

| | Usual way | Haazri | Cost per scan |
|---|---|---|---|
| **Face matching** | Send the photo to a cloud API (AWS Rekognition, Azure Face) at about $1 per 1,000 images | Runs **on the employee's phone** with face-api (MIT licence), shipped inside the app | **₹0** |
| **Location** | Google Maps / Places API with a billing key | The browser's own GPS (`navigator.geolocation`). No maps service is called | **₹0** |

For comparison: 3,000 staff scanning in and out every day on a cloud face
API is about 180,000 images a month, or roughly **₹15,000 a month**. On the
phone it's nothing, and it stays nothing however many shops you sell to.

## Firebase free plan (Spark), per project

| Limit | Per day / total |
|---|---|
| Firestore document reads | 50,000 / day |
| Firestore document writes | 20,000 / day |
| Firestore deletes | 20,000 / day |
| Firestore storage | 1 GiB total |
| Authentication (email/password) | no charge |

**Make a separate Firebase project for Haazri.** The quotas are counted per
project, and sharing mirrorBill's project would mean both products eat the
same 50,000 reads.

### What one employee costs a day

The app is built around reads, because reads run out first:

- **One document per shop per day** holds everybody's attendance, so a
  whole day's register is 1 read, not 15.
- **Staff phones don't use live listeners.** They read today's document when
  opened. The shop's perimeter and the person's own face data are cached on
  the phone and re-read every 12 hours at most.
- **The owner's team list is cached** and re-read only when a card actually
  changed (tracked by a counter on the shop document).
- **Security rules** read the login's `members` document on every request.
  That's counted below.

| Action | Reads | Writes |
|---|---|---|
| Open the app to scan in | 2 | – |
| Scan in | 1 | 1 |
| Open the app to scan out | 2 | – |
| Scan out | 1 | 1 |
| Shop + face data refresh (12-hour cache) | ~4 | – |
| **Per employee per day** | **~10–11** | **2** |
| Owner, per shop per day (3 opens, live register, payroll views) | ~40 | ~3 |

### Your scenarios

| Shops × staff | Staff total | Reads / day | % of 50k | Writes / day | % of 20k |
|---|---|---|---|---|---|
| 100 × 8 | 800 | ~13,000 | **26%** | ~1,900 | 10% |
| 100 × 15 | 1,500 | ~21,000 | **41%** | ~3,300 | 17% |
| 200 × 8 | 1,600 | ~26,000 | **52%** | ~3,800 | 19% |
| 200 × 15 | 3,000 | ~41,000 | **82%** | ~6,500 | 33% |

These are estimates from the design, not measurements. Watch the real
numbers in Firebase console → Firestore → Usage for the first few weeks.

**At about 200 shops of 15 you're at 80%+ of the free reads.** Before you
get there, pick one:

1. **A second free project.** Put shops 1–150 on project A and new shops on
   project B (two copies of the site with different `js/config.js`). Each
   project has its own 50,000 reads a day. ₹0.
2. **Switch the project to Blaze (pay as you go).** The same free quota still
   applies every day, and you pay only for what's above it. Firestore reads
   cost about $0.03–0.06 per 100,000. Going over by 20,000 reads a day is
   600,000 a month, which is **well under ₹100 a month**. Set a budget alert
   at ₹200 in Google Cloud Billing.

### Storage (1 GiB)

| What | Size | 200 shops × 15, per year |
|---|---|---|
| A day's record per person (no photo) | ~150 bytes | ~135 MB |
| Face data per person (3 × 128 numbers) | ~4 KB | ~12 MB (total, not yearly) |
| Outside-perimeter request with its small photo | ~3–4 KB | kept 90 days, then auto-deleted: ~110 MB steady |

**About 250 MB after the first year**, growing about 135 MB a year after
that. That's roughly 5 years before the free 1 GiB fills.

The one setting that changes this is **"Keep a small picture of every
scan"** (off by default). Turned on for every shop, it adds about 2–3 KB per
scan, which is about 2–3 GB a year at 200 × 15. Leave it off unless a shop
really needs it.

## Hosting: use Cloudflare Pages, not Firebase Hosting

The face model is about **7.5 MB**. Each phone downloads it **once** and
keeps it (service worker plus browser cache).

- 3,000 staff + 200 owners ≈ 3,200 phones × 7.5 MB ≈ **24 GB, spread over
  the months you onboard shops**.
- Firebase Hosting's free plan allows **360 MB a day**, which is only about
  48 new phones a day. Onboard a few shops in one day and you're over.
- **Cloudflare Pages is free with unlimited bandwidth** and allows
  commercial use. Host the site there. Firebase is still used for login and
  the database only.

(Vercel's free Hobby plan doesn't allow commercial use, so it's not an
option for a product you sell.)

## Your price vs your cost

| | |
|---|---|
| You charge | ₹2,000 once per shop |
| 100 shops | ₹2,00,000 |
| 200 shops | ₹4,00,000 |
| Running cost | **₹0/month** (optionally a domain, about ₹800/year) |
| Worst case above 200 × 15 | Blaze overflow, about ₹50–200/month |
