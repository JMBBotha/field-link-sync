# WALDA: file a first-fit point, and read what is due to issue

A first-fit point is one photo on a development house: the area, the unit size, and the pipe length. **First fit complete** is a separate tap. It is not the labour tick **First fit (sleeves & drains)**, and it is not the project chip that already says **First fit done**.

Signing in as the WALDA accounts bot is required for the two calls below. The bot’s company is the only company they can see. A staff login uses the same checks from the app. The anonymous key is refused.

Nothing in these calls sends a quote, an email, or a WhatsApp message. Invoice numbers are given to drafts the same way other drafts get a number. Sent invoices and payments are left as they are.

## File a point

`walda_record_first_fit_point`

The photo itself is uploaded first, into the private `house-photos` bucket. This call stores the path. It does not accept the image bytes.

| Name | Required | Meaning |
| --- | --- | --- |
| `p_house` | one of these | `project_houses.id` in the bot’s company. |
| `p_house_no` | one of these | The house number, for example `32` or `17528`. Optional project prefix `AVEC 32` or `SV 17528` when two projects share a number. |
| `p_project` | no | Limits the house-number search to one project. |
| `p_area` | yes | The room. If the house has a unit list, the area must match that list. If the list is empty, the typed area is kept. |
| `p_unit_size` | yes | `9K`, `12K`, `18K`, or `24K`. `12k`, `12`, `12000`, and `12BTU` are accepted and stored as `12K`. Anything else is refused. |
| `p_pipe_m` | yes | Metres, greater than 0 and at most 200. `6.5`, `6,5m`, and `6.5m` are the same. |
| `p_storage_path` | yes | `{company_id}/{project_id}/{house_id}/{file}.jpg` in `house-photos`. |
| `p_caption` | no | Up to 500 characters. |
| `p_source_ref` | yes | WALDA’s own id for this photo, up to 120 characters. The same reference does not create a second point. |

```js
const { data, error } = await supabase.rpc("walda_record_first_fit_point", {
  p_house_no: "17528",
  p_area: "Lounge",
  p_unit_size: "12K",
  p_pipe_m: "6.5m",
  p_storage_path: `${companyId}/${projectId}/${houseId}/${photoId}.jpg`,
  p_source_ref: "wa-17528-lounge-1",
});
```

| `result` | Meaning |
| --- | --- |
| `inserted` | First time this source reference was filed. |
| `updated` | The same reference was filed again and the area, size, metres, path, or caption changed. |
| `skipped` | The same reference and the same details were already stored. |

Each call, including a skip, is written to `bot_audit_log` as `first_fit_point_inserted`, `first_fit_point_updated`, or `first_fit_point_skipped`.

The quote unit is the Samsung AR40H wall unit. The size on the point is still chosen from 9K / 12K / 18K / 24K. WALDA does not pick a cassette or a duct.

### Errors

| Message | When |
| --- | --- |
| `not allowed` | Not signed in as an enabled accounts bot. |
| `This company is not active` | The bot’s company is not active. |
| `House not found` | No house in this company matches. |
| `More than one house matches that number` | Send `p_house` or a project prefix. |
| `Give the house id or the house number` | Both were left out. |
| `Area is required` | Area was blank. |
| `Area is not on this house` | The house has a unit list and the area is not on it. |
| `Unit size must be 9K, 12K, 18K or 24K` | The size could not be read as one of those four. |
| `Pipe metres must be more than 0 and at most 200` | Missing, zero, or over 200 m. |
| `Photo path is required` | No storage path. |
| `Photo path must be in this company's house-photos folder` | The path is not `{company}/{project}/{house}/…`. |
| `Source reference is required` | No `p_source_ref`. |
| `That source reference is already filed on another house` | The same reference was used for a different house. |

## What First fit complete does

A technician or someone in the office taps **First fit complete** in the app. WALDA does not set it. The tap is refused until every saved point has an area, a size, and pipe metres, and every area on the house list has a point. A house with an empty list can still be completed once it has at least one complete point. The labour tick is not changed.

The tap turns **Live** on and opens one draft quote for that house:

- One catalogue line per area and size, matched to a live Samsung AR40H wall unit of that size. If none is on the live price list, the line is named with **model needed** and priced at R0.
- One piping line per area and size, using the recorded metres, priced at **R0** and named **price needed**. The existing send block stops the quote leaving draft until those lines have a price.
- The client’s discount percent, once, on the quote total. Cape Estates on Massair CT is stored as 5 percent. It is not also taken off the lines.
- The quote stays `draft`. It is linked to the house and to that project’s client. It is not sent.

Tapping again does not open a second quote. If the office has edited the draft, the lines are left as edited and the quote is flagged. If the quote has already left draft, it is left alone and flagged.

**Undo** turns Live off, clears both due-to-issue dates, and flags the draft quote and any draft invoices. It does not delete them. The undo is written to `bot_audit_log` as `first_fit_undone`.

## When the two invoices are due

This is a schedule. Issuing and sending stay a person’s job.

Settings live on `client_issue_settings`, per client. The defaults are 45 days to the deposit, 60 days to the balance, and a draft prepared 7 days before the due date. Snap is off unless `issue_snap_day` is set. Cape Estates (`3dde87f5-60cf-5cda-bc54-edd8b0e553cc` on Massair CT) is snapped to the next 15th on or after the computed date, with the 5 percent discount.

- **Deposit:** 45 days after First fit complete, then the snap. Half of the quote total, or less if other invoices are already on the house so the house is not billed twice.
- **Balance:** 60 days after the deposit’s actual issue date, then the snap. The amount is the quote total minus every other live invoice on the house. The two new invoices then add up to the quote when nothing else has been invoiced.
- Until the deposit is issued, the balance date is an **estimate** from the planned deposit date. It is not marked overdue, and no balance draft is created.

Drafts use the normal invoice number. Status stays `draft`. `sent_at` is left empty.

On the house and on the project, each date shows one of: **Upcoming**, **Due soon** (inside the 7 days), **Due today**, **Overdue to issue**. An estimate shows **Estimated** instead of those.

## 8am digest

`walda_first_fit_issue_digest`

| Name | Required | Meaning |
| --- | --- | --- |
| `p_on` | no | The Johannesburg date to judge. Omit it to use today. |

```js
const { data, error } = await supabase.rpc("walda_first_fit_issue_digest", { p_on: "2026-11-16" });
```

`data.rows` lists deposit and balance lines that are due soon, due today, or overdue to issue. Upcoming lines and estimated balance lines are left out. Each row has `kind`, `state`, `due_on`, `house_no`, `project_name`, `amount` when a draft exists, and `link` (`/admin/projects/{project}?house={house}`).

The same figures are on the view `first_fit_issue_schedule` for staff who can already read the project. The digest is the call WALDA should use. It also prepares a numbered draft when the 7-day window is open, still without sending it.

## Job photos

Ordinary job photos are unchanged for leads. New uploads are stored at `{company_id}/{lead_id}/{file}`. Photos already stored at `{lead_id}/{file}` stay there, and signed URLs keep using the stored path. A row’s `company_id` is filled from the lead. A photo cannot be filed against another company’s lead.
