# Marketing placeholder photo credits

All photos in this directory are **temporary marketing placeholder assets** used
on the main landing page and use-case cards (Redesign V4, Phase 2). They are not
final brand photography and are expected to be revisited — see the note at the
bottom of this file.

Sourcing rule for every image in this directory: Unsplash or Pexels, standard
free license only (no Unsplash+ / paid tier), no attribution legally required
by either license. Provenance is still recorded here as a matter of internal
due diligence and to make future replacement easier.

## Originals (10 sourced photos)

| Filename | Source page | Photographer | Provider | License |
|---|---|---|---|---|
| `wedding-couple.jpg` | *(replaced — see Phase 4 below)* | Bruna Fossile | Pexels | Pexels License |
| `wedding-guests.jpg` | *(replaced — see Phase 4 below)* | Taha Samet Arslan | Pexels | Pexels License |
| `wedding-dancefloor.jpg` | *(superseded — see Replacements below)* | SOURCE METADATA MISSING | SOURCE METADATA MISSING | Unsplash/Pexels standard free license (provider not recorded) |
| `wedding-detail.jpg` | *(replaced — see Phase 4 below)* | Karolina Grabowska | Pexels | Pexels License (CC0) |
| `wedding-group.jpg` | *(replaced — see Phase 4 below)* | Taha Samet Arslan | Pexels | Pexels License |
| `wedding-toast.jpg` | *(replaced — see Phase 4 below)* | Faruk Tokluoğlu | Pexels | Pexels License |
| `usecase-birthday.jpg` | *(superseded — see Phase 3B below)* | SOURCE METADATA MISSING | SOURCE METADATA MISSING | Unsplash/Pexels standard free license (provider not recorded) |
| `usecase-corporate.jpg` | *(superseded — see Phase 3C below)* | SOURCE METADATA MISSING | SOURCE METADATA MISSING | Unsplash/Pexels standard free license (provider not recorded) |
| `usecase-photographer.jpg` | *(superseded — see Phase 3D below)* | SOURCE METADATA MISSING | SOURCE METADATA MISSING | Unsplash/Pexels standard free license (provider not recorded) |
| `usecase-planner.jpg` | *(superseded — see Replacements below)* | SOURCE METADATA MISSING | SOURCE METADATA MISSING | Unsplash/Pexels standard free license (provider not recorded) |

These 10 originals were sourced during Phase 2 development by an automated
sourcing pass that verified each photo's license at selection time (standard
free license, Unsplash+ explicitly excluded) but did not persist a durable
per-image manifest into the repository. The files themselves carried no
embedded EXIF/attribution metadata (confirmed via `sips`/`mdls` — both stock
providers strip this on download), so the original source page, photographer
name, and provider for these could not be reconstructed after the fact and
were not guessed. As of Phase 4 (below), the last 5 unresolved entries
(the wedding set) have been replaced with newly-sourced, fully-provenanced
photos, bringing the unknown-provenance count to **zero**.

## Derivatives

Every `-thumb.jpg` (240×240, cover crop), `-card.jpg` (800×600, cover crop),
and `-square.jpg` (480×480, cover crop) file is a `sharp`-generated resize of
its same-named original above, done for this project (project already
depends on `sharp`; `next.config.js` sets `images.unoptimized: true`, so
pre-sizing happens at the file level, not via `next/image` at runtime).
Derivatives carry the same license/provenance status as their source
original — no separate sourcing occurred for them.

- `wedding-detail-square.jpg` (Phase 3A, Weddings page) — derivative of
  `wedding-detail.jpg`, used in the Wedding page's QR/table-signage visual.

## Replacements (Phase 2 visual review fixes)

Two images from the original set were replaced after visual QA flagged them as
weak — see `usecase-planner-card.jpg` (P1: empty venue, no visible planner
activity) and `wedding-dancefloor-thumb.jpg` (P1: illegible extreme leg crop)
in the Phase 2 Visual Review report. Unlike the originals above, full
provenance was captured at sourcing time for both replacements:

| Filename | Source page | Photographer | Provider | License |
|---|---|---|---|---|
| `usecase-planner.jpg` / `usecase-planner-card.jpg` | [pexels.com/photo/3933690](https://www.pexels.com/photo/woman-in-white-shirt-holding-black-clipboard-3933690/) | Andrea Piacquadio | Pexels | Pexels License — free for commercial use, no attribution required |
| `wedding-dancefloor.jpg` / `wedding-dancefloor-thumb.jpg` | [pexels.com/photo/13434438](https://www.pexels.com/photo/bride-groom-and-wedding-guests-dancing-at-the-wedding-reception-13434438/) | Jonathan Nenemann | Pexels | Pexels License — free for commercial use, no attribution required |

Rejected during sourcing (kept here for context, not used): an initial
dancefloor pick (Wesley Tingey, unsplash.com/photos/9INtcavGkko) was correct
on composition but black-and-white, inconsistent with this set's warm color
grade, so a second pass found the color alternative above instead. Two other
Unsplash candidates were disqualified outright as Getty Images contributions
licensed under Unsplash+ (paid tier, out of scope for this project).

## Phase 3A (Weddings page)

No new photos were sourced for the Weddings redesign — it reuses the existing
wedding photo set (couple/toast/guests/dancefloor/detail/group, all already
listed above) for the hero/phone-mockup and Problem Section, plus the
existing `usecase-photographer-card.jpg` / `usecase-planner-card.jpg` (see
Replacements above for the planner credit; the photographer photo is one of
the 10 originals, still SOURCE METADATA MISSING) for the professional
cross-link cards. One new derivative was generated (`wedding-detail-square.jpg`,
see Derivatives above). This keeps the unknown-provenance count unchanged at
9 (`usecase-photographer.jpg`, its `-card` derivative, and the 7 other
originals not yet superseded) — it does not increase it, per Section 13's
progressive-reduction goal, though it also doesn't reduce it this phase since
no unknown-provenance asset happened to be on this page's critical path.

## Phase 3B (Birthday + Private Party pages)

Twelve new photos were sourced for this phase — six per segment, deliberately
non-overlapping so each page reads as visually distinct from the other and
from Weddings. All sourced from Unsplash or Pexels standard free license,
verified individually on each photo's own page (not a search-results page)
before download; no Unsplash+ candidates were used (three were found and
rejected during sourcing, see below).

### Birthday set

| Filename(s) | Source page | Photographer | Provider | License |
|---|---|---|---|---|
| `birthday-cake.jpg` / `-thumb.jpg` / `-card.jpg` | [unsplash.com/photos/zzTjty6f_1Y](https://unsplash.com/photos/a-birthday-cake-with-lit-candles-sitting-on-a-table-zzTjty6f_1Y) | Zoe Fitzgerald | Unsplash | Unsplash License (confirmed not Unsplash+) |
| `birthday-friends.jpg` / `-thumb.jpg` | [pexels.com/photo/35370605](https://www.pexels.com/photo/joyful-birthday-celebration-with-friends-35370605/) | Reza Yudhistira | Pexels | Pexels License |
| `birthday-group.jpg` / `-thumb.jpg` (also reused as `usecase-birthday.jpg` / `-card.jpg`, see Replacements below) | [pexels.com/photo/23495692](https://www.pexels.com/photo/a-group-of-people-celebrating-a-birthday-party-23495692/) | Vitaly Gariev | Pexels | Pexels License |
| `birthday-laughter.jpg` / `-thumb.jpg` | [unsplash.com/photos/_Onv85x8VdA](https://unsplash.com/photos/a-group-of-women-laughing-and-laughing-together-_Onv85x8VdA) | peter bucks | Unsplash | Unsplash License (confirmed not Unsplash+) |
| `birthday-dance.jpg` / `-thumb.jpg` | [unsplash.com/photos/h3bZqJlAMOs](https://unsplash.com/photos/a-group-of-people-dancing-at-a-party-h3bZqJlAMOs) | Nereid Ndreu | Unsplash | Unsplash License (confirmed not Unsplash+) |
| `birthday-candid.jpg` / `-thumb.jpg` / `-square.jpg` | [pexels.com/photo/19584926](https://www.pexels.com/photo/young-woman-blowing-out-the-candles-on-her-birthday-cake-19584926/) | Lucianna Bueno | Pexels | Pexels License |

### Private Party set

| Filename(s) | Source page | Photographer | Provider | License |
|---|---|---|---|---|
| `party-family.jpg` / `-thumb.jpg` | [pexels.com/photo/4262173](https://www.pexels.com/photo/family-having-dinner-and-celebrating-4262173/) | August de Richelieu | Pexels | Pexels License |
| `party-dinner.jpg` / `-thumb.jpg` / `-card.jpg` | [pexels.com/photo/7748466](https://www.pexels.com/photo/analogue-photograph-with-grain-of-people-dinning-and-flowers-on-table-7748466/) | Enes Çelik | Pexels | Pexels License |
| `party-toast.jpg` / `-thumb.jpg` | [unsplash.com/photos/ch4Fc1cGTq4](https://unsplash.com/photos/a-group-of-people-toasting-with-wine-glasses-ch4Fc1cGTq4) | Micaela Peduzi | Unsplash | Unsplash License (confirmed not Unsplash+) |
| `party-celebration.jpg` / `-thumb.jpg` | [pexels.com/photo/35688755](https://www.pexels.com/photo/casual-gathering-at-indoor-event-venue-35688755/) | Filip Rankovic Grobgaard | Pexels | Pexels License |
| `party-conversation.jpg` / `-thumb.jpg` / `-square.jpg` | [pexels.com/photo/6955635](https://www.pexels.com/photo/friends-having-a-good-conversation-over-dinner-6955635/) | cottonbro studio | Pexels | Pexels License |
| `party-group.jpg` / `-thumb.jpg` (also reused as `usecase-private-party.jpg` / `-card.jpg`, see below) | [pexels.com/photo/8088248](https://www.pexels.com/photo/elderly-women-celebrating-a-party-8088248/) | Yaroslav Shuraev | Pexels | Pexels License |

### Replacements / new cross-link assets

| Filename | Change | Source |
|---|---|---|
| `usecase-birthday.jpg` / `-card.jpg` | **Replaced** — was one of the 10 unknown-provenance originals (SOURCE METADATA MISSING), used on the homepage's use-case grid and now also on Private Party's cross-link card. Re-cropped from `birthday-group.jpg` above (Vitaly Gariev, Pexels), full provenance now on file. | See `birthday-group.jpg` row above |
| `usecase-private-party.jpg` / `-card.jpg` | **New** — did not exist before this phase; used on Birthday's cross-link card. Re-cropped from `party-group.jpg` above (Yaroslav Shuraev, Pexels). | See `party-group.jpg` row above |

This reduces the unknown-provenance legacy count from **9 to 8** (`usecase-photographer.jpg` + its `-card` derivative, and 7 other originals — see Originals table above; `usecase-birthday.jpg` is no longer on that list).

Rejected during sourcing (kept here for context, not used): two Unsplash+ candidates
were found and explicitly excluded — a rooftop birthday party photo (credited
"Curated Lifestyle") and a dark-room friends-laughing photo (@3tnik) — both
pages stated "Licensed under the Unsplash+ License." A third result (a
business toast photo) was skipped without opening, as Unsplash's own search
results already labeled it "Photo on Unsplash+."

One kept photo worth flagging: `birthday-friends.jpg` is shot against a party
backdrop with visible confetti/streamers rather than a fully unstaged
environment. It was kept because the reactions read as genuine in-the-moment
(mid-confetti-pop, opening gifts) rather than static posed grins, and no
unstaged alternative with equally clear birthday context and equally genuine
expressions was found. Worth a second look if a stricter candid-only bar is
wanted for a future brand-photography pass.

## Phase 3C (Corporate Event page)

Six new photos were sourced for the Corporate redesign — a dedicated
professional-event set, deliberately avoiding empty-office/handshake/
boardroom/laptop clichés per the brief. All sourced from Unsplash or Pexels
standard free license, verified individually on each photo's own page before
download; two Unsplash+ candidates were found and rejected during sourcing
(see below).

| Filename(s) | Source page | Photographer | Provider | License |
|---|---|---|---|---|
| `corporate-stage.jpg` / `-thumb.jpg` | [unsplash.com/photos/AsxOJcsaR4g](https://unsplash.com/photos/speaker-presenting-on-stage-to-an-audience-AsxOJcsaR4g) | Carlos Gil | Unsplash | Unsplash License (confirmed not Unsplash+) |
| `corporate-networking.jpg` / `-thumb.jpg` / `-card.jpg` | [pexels.com/photo/8761555](https://www.pexels.com/photo/groups-of-people-talking-in-the-office-8761555/) | Pavel Danilyuk | Pexels | Pexels License |
| `corporate-team.jpg` / `-thumb.jpg` | [pexels.com/photo/7551228](https://www.pexels.com/photo/happy-people-with-big-smiles-7551228/) | RDNE Stock project | Pexels | Pexels License |
| `corporate-celebration.jpg` / `-thumb.jpg` (also reused as `usecase-corporate.jpg` / `-card.jpg`, see below) | [unsplash.com/photos/Kxo17w7BurY](https://unsplash.com/photos/a-diverse-group-of-colleagues-celebrating-success-in-an-office-Kxo17w7BurY) | Vitaly Gariev | Unsplash | Unsplash License (confirmed not Unsplash+) |
| `corporate-candid.jpg` / `-thumb.jpg` | [pexels.com/photo/18999484](https://www.pexels.com/photo/attentive-group-during-presentation-18999484/) | Matheus Bertelli | Pexels | Pexels License |
| `corporate-detail.jpg` / `-thumb.jpg` / `-square.jpg` | [pexels.com/photo/7648057](https://www.pexels.com/photo/women-standing-by-the-registration-booth-at-a-business-conference-7648057/) | RDNE Stock project | Pexels | Pexels License |

**Replacement**: `usecase-corporate.jpg` / `-card.jpg` — was one of the 10
unknown-provenance originals (SOURCE METADATA MISSING), used on the
homepage's use-case grid. Re-cropped from `corporate-celebration.jpg` above
(Vitaly Gariev, Unsplash), full provenance now on file.

This reduces the unknown-provenance legacy count from **8 to 7**
(`usecase-photographer.jpg` + its `-card` derivative, and 5 other originals).

Rejected during sourcing (kept here for context, not used): two Unsplash+
candidates were found and explicitly excluded — a champagne-toast office
photo and a "toast to success" business-people photo, both pages stated
"Licensed under the Unsplash+ License." An initial networking candidate was
downloaded and visually reviewed, then rejected after inspection (it turned
out to be a dim, candlelit evening wine gathering, closer to a house party
than a professional daytime event) and swapped for the current pick.

Two photos worth flagging for a future stricter pass: `corporate-team.jpg`
reads more like an outdoor team-building field-day (matching t-shirts,
running, park setting) than a polished corporate offsite — kept because it
was the closest genuine non-staged match found, and is only used as one of
six small phone-mockup thumbnails (not a full-bleed hero image), so the
context is cropped tightly. `corporate-candid.jpg` shows attentive engagement
rather than laughter — satisfies "genuine audience reaction" more than a
laughing-specifically shot.

## Phase 3D (Wedding Photographers + Event Planners pages)

Two dedicated photo sets were sourced — a photographer-at-work set (6/6
complete) and a planner/coordinator-at-work set (5/6, one gap — see below).
All sourced from Pexels (Set A also included one Unsplash pick previously;
this phase's sourcing pass used Pexels exclusively), verified individually on
each photo's own page before download.

### Photographer set

| Filename(s) | Source page | Photographer | Provider | License |
|---|---|---|---|---|
| `photographer-shooting.jpg` / `-thumb.jpg` / `-card.jpg` (also reused as `usecase-photographer.jpg` / `-card.jpg`, see below) | [pexels.com/photo/33975526](https://www.pexels.com/photo/photographer-captures-wedding-ceremony-outdoors-33975526/) | Sóc Năng Động | Pexels | Pexels License |
| `photographer-guests.jpg` / `-thumb.jpg` | [pexels.com/photo/5935248](https://www.pexels.com/photo/anonymous-woman-photographing-positive-diverse-ladies-during-event-on-rooftop-5935248/) | Kampus Production | Pexels | Pexels License |
| `photographer-camera.jpg` / `-thumb.jpg` | [pexels.com/photo/17169150](https://www.pexels.com/photo/hand-holding-camera-and-taking-pictures-of-couple-17169150/) | Orhan Pergel | Pexels | Pexels License |
| `photographer-reception.jpg` / `-thumb.jpg` | [pexels.com/photo/29486090](https://www.pexels.com/photo/event-photographer-capturing-a-lively-party-scene-29486090/) | Matheus Bertelli | Pexels | Pexels License |
| `photographer-review.jpg` / `-thumb.jpg` | [pexels.com/photo/16313529](https://www.pexels.com/photo/photographer-holding-camera-over-laptop-16313529/) | Kawê Rodrigues | Pexels | Pexels License |
| `photographer-candid.jpg` / `-thumb.jpg` | [pexels.com/photo/16322930](https://www.pexels.com/photo/bride-drinking-a-cocktail-and-wedding-guests-cheering-around-her-16322930/) | Jonas Wilson | Pexels | Pexels License |

**Replacement**: `usecase-photographer.jpg` / `-card.jpg` — was the last
remaining unknown-provenance `usecase-*` original (SOURCE METADATA MISSING),
used on the homepage's use-case grid and the Wedding/Corporate/Planners
cross-link cards. Re-cropped from `photographer-shooting.jpg` above, full
provenance now on file.

### Planner set

| Filename(s) | Source page | Photographer | Provider | License |
|---|---|---|---|---|
| `planner-working.jpg` / `-thumb.jpg` / `-card.jpg` | [pexels.com/photo/7648041](https://www.pexels.com/photo/a-woman-in-registration-desk-7648041/) | RDNE Stock project | Pexels | Pexels License |
| `planner-setup.jpg` / `-thumb.jpg` | [pexels.com/photo/20680118](https://www.pexels.com/photo/woman-preparing-a-wedding-ceremony-20680118/) | otc_lens | Pexels | Pexels License |
| `planner-vendor.jpg` / `-thumb.jpg` | [pexels.com/photo/6050388](https://www.pexels.com/photo/elderly-man-holding-a-clipboard-beside-another-man-6050388/) | Gustavo Fring | Pexels | Pexels License |
| `planner-guests.jpg` / `-thumb.jpg` | [pexels.com/photo/7648057](https://www.pexels.com/photo/women-standing-by-the-registration-booth-at-a-business-conference-7648057/) | RDNE Stock project | Pexels | Pexels License |
| `planner-checklist.jpg` / `-thumb.jpg` | [pexels.com/photo/6699279](https://www.pexels.com/photo/men-in-suits-holding-papers-and-notebooks-in-a-wedding-reception-venue-6699279/) | Gustavo Fring | Pexels | Pexels License |
| `planner-supervision-thumb.jpg` | *(not sourced — reused existing asset, see note below)* | Andrea Piacquadio | Pexels | Pexels License |

Two Set B photos are flagged for a future stricter pass: `planner-working`
and `planner-guests` are both from the same registration-desk shoot and read
as a corporate-conference setting rather than a wedding — acceptable given
the Planners page explicitly serves weddings, corporate events, and private
parties alike (its own copy already frames this breadth), but worth a look if
a more wedding-specific set is wanted later. `planner-vendor` is set in a
florist's retail shop rather than on-site at a venue, and which figure reads
as "coordinator" vs. "vendor" is inferred rather than unambiguous.

**Gap, resolved by reuse**: `planner-supervision` (brief: a coordinator
observing/supervising a live event from the side) could not be filled after
two thorough sourcing passes (35+ query variations across both attempts,
including a broadened-criteria second pass). Every close candidate either
read as a bystander/guest, an AV/broadcast technician, or security staff
rather than a coordinator — see the manifest for the full rejected-candidate
list with reasoning. Rather than force a mismatched or fabricated entry, the
6th PhoneMockup slot on the Planners page reuses the existing, already
fully-provenanced `usecase-planner.jpg` (Andrea Piacquadio, Pexels — see
Replacements above) as a new `planner-supervision-thumb.jpg` derivative. This
is a legitimate reuse of an already-approved asset, not a new unknown-
provenance addition.

This reduces the unknown-provenance legacy count from **7 to 6**
(5 wedding-set originals — `wedding-couple.jpg`, `wedding-guests.jpg`,
`wedding-detail.jpg`, `wedding-group.jpg`, `wedding-toast.jpg` — the last
remaining unresolved entries from the original Phase 2 batch of 10).

## Phase 4 (Blocker remediation — wedding set replacement)

The 5 remaining unresolved originals from the Phase 2 batch (`wedding-couple`,
`wedding-guests`, `wedding-detail`, `wedding-group`, `wedding-toast`) were
replaced outright rather than re-investigated — their provenance was
confirmed unrecoverable (empty EXIF/`mdls` on all 5, no sourcing script or
additional log anywhere in repo history) before this decision was made. Each
was sourced from Pexels, verified individually on its own photo page (not a
search-results page), matching this file's standing sourcing rule.

| Filename(s) | Source page | Photographer | Provider | License |
|---|---|---|---|---|
| `wedding-couple.jpg` / `-thumb.jpg` / `-card.jpg` | [pexels.com/photo/34410635](https://www.pexels.com/photo/romantic-outdoor-wedding-embrace-by-lake-34410635/) | Bruna Fossile | Pexels | Pexels License — free for commercial use, no attribution required |
| `wedding-guests.jpg` / `-thumb.jpg` | [pexels.com/photo/15530652](https://www.pexels.com/photo/guests-at-wedding-reception-15530652/) | Taha Samet Arslan | Pexels | Pexels License — free for commercial use, no attribution required |
| `wedding-detail.jpg` / `-thumb.jpg` / `-square.jpg` | [pexels.com/photo/6165](https://www.pexels.com/photo/gold-wedding-rings-with-decoration-6165/) | Karolina Grabowska (kaboompics.com) | Pexels | Pexels License (CC0) — free for commercial use, no attribution required |
| `wedding-group.jpg` / `-thumb.jpg` | [pexels.com/photo/15530616](https://www.pexels.com/photo/photo-of-the-walking-groom-and-bride-and-a-crowd-of-wedding-guests-15530616/) | Taha Samet Arslan | Pexels | Pexels License — free for commercial use, no attribution required |
| `wedding-toast.jpg` / `-thumb.jpg` | [pexels.com/photo/11350576](https://www.pexels.com/photo/man-in-black-suit-holding-a-glass-of-wine-11350576/) | Faruk Tokluoğlu | Pexels | Pexels License — free for commercial use, no attribution required |

`wedding-guests` and `wedding-group` were deliberately picked from the same
photographer's shoot (Taha Samet Arslan, adjacent photo IDs) so the two
appear together on the homepage/Wedding page without a jarring style
mismatch.

Rejected during sourcing (kept here for context, not used): an initial
`wedding-couple` candidate (Moose Photos, pexels.com/photo/1587042) was
Pexels-licensed and well-composed but shot against a flat studio backdrop —
inconsistent with every other photo in this project, which is all real,
on-location event photography, not studio stock. An initial `wedding-toast`
candidate (pexels.com/photo/35538837) was rejected after visual inspection
of the downloaded file revealed a visible **Welch's-branded juice bottle**
in frame — a real commercial trademark, unusable in marketing material and
not caught by the page description alone. Both replacements above were
verified by downloading and directly viewing the actual image, not just
reading the page's text description, after these two misses.

All derivatives were regenerated deterministically from these new originals
using this project's existing `sharp` dependency: `-thumb.jpg` at 240×240,
`-card.jpg` at 800×600, `-square.jpg` at 480×480, all `fit: cover` with
attention-based (saliency) cropping; full-size originals resized so their
long edge is 1200px, matching the convention already used by every other
original in this directory.

## Status

This directory is a **placeholder asset pipeline**, not final brand
photography. Provenance is now fully recorded for every photo (0 unresolved,
down from 10 at the start of Phase 3). Remaining recommended item before any
brand/marketing asset freeze: resolve the `planner-supervision` gap noted
under Phase 3D above.
