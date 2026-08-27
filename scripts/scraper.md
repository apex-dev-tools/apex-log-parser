# Salesforce Debug Log Events - Scraper Reference

How to fetch raw content from the two official Salesforce sources used in
`salesforce-debug-log-events.json`. Source ids match `sources` in that file and in `scrape.ts`:
**S1 is the developer docs, S2 is Salesforce Help.**

Both sites are client-side rendered, so fetching the page HTML returns only a JavaScript bootstrap.
Both also expose an endpoint that returns the content as data, and **neither needs a browser, cookies
or authentication**.

## Read this first: every failure returns HTTP 200

Neither source uses a status code to report a bad request. `res.ok` is never a sufficient check.

| What went wrong | What you get back |
| --- | --- |
| Blocked as a bot | `403` — the one real status code |
| Unknown doc version (S1) | `200` with `content-length: 0` |
| Unknown release (S2) | `200`, `state: "SUCCESS"`, and no `record` key |
| Large article (S2) | `Content__c` holds a "cannot populate" sentence, not the content |

## The User-Agent decides whether you are blocked

developer.salesforce.com sits behind Akamai, which gates on `User-Agent`. Measured 2026-08-27,
stable across repeats:

| `User-Agent` | Result |
| --- | --- |
| `node` — Node `fetch`'s default | 403 |
| `node-fetch` | 403 |
| `Mozilla/5.0 (X11; Linux x86_64) … Chrome/131 …` | 403 |
| `curl/8.7.1` | 200 |
| `apex-log-parser-scraper/1.0 (+https://github.com/apex-dev-tools/apex-log-parser)` | 200 |

An honest tool name passes. **Impersonating a browser is worse than saying who you are** — do not
"fix" a 403 by pasting a Chrome string. A 403 is deterministic, so it is never worth retrying.

---

## S1: Salesforce Developer Docs - Debug Log Console

- **Display URL**: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_system_log_console.htm

### Content

```
GET https://developer.salesforce.com/docs/get_document_content/{doc_set}/{page_id}/{locale}/{doc_version}
```

| Parameter | Description | Example |
| --- | --- | --- |
| `doc_set` | Collection id, the URL path segment after `atlas.en-us.` | `apexcode` |
| `page_id` | Page filename from the display URL | `apex_debugging_system_log_console.htm` |
| `locale` | Language and region | `en-us` |
| `doc_version` | Doc version, **discovered** — see below | `262.0` |

The response is **JSON**, with the rendered page HTML as a string under `content`.

### Version discovery

```
GET https://developer.salesforce.com/docs/get_document/atlas.en-us.apexcode.meta
```

- `version` — the release Salesforce currently serves as GA. This is the default to scrape.
- `available_versions` — every published release. Validate an override against this.
- `version.version_text` reads like `Summer '26 (API version 67.0)`, which is where the release key
  and label in `releases` come from.

Do **not** compute the doc version, and do not default to `available_versions[0]`: the first entry is
the next release's preview. For reference only, the historical relation is
`doc_version = (api_version - 60) × 2 + 248`, incrementing by 2 for each of the 3 releases a year.

---

## S2: Salesforce Help - Debug Log Levels

- **Display URL**: https://help.salesforce.com/s/articleView?id=platform.code_setting_debug_log_levels.htm&language=en_US&type=5

An Aura (`siteforce:communityApp`) Experience Cloud site. Its Apex actions answer unauthenticated
requests, so the content is reachable with two POSTs. `robots.txt` allows `/s/articleView`.

```
POST https://help.salesforce.com/s/sfsites/aura
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
```

Three form fields:

| Field | Value |
| --- | --- |
| `message` | `{"actions":[{"id":"1;a","descriptor":"aura://ApexActionController/ACTION$execute","params":{"classname":…,"method":…,"params":…}}]}` |
| `aura.context` | `{"app":"siteforce:communityApp"}` |
| `aura.token` | `null` |

**`aura.token=null` is the field that makes this work.** `fwuid`, `loaded`, `mode` and
`aura.pageURI` are all optional, so the SPA shell never has to be scraped for a framework id. No
cookies and no CSRF token are needed.

### Call 1 - the release

`classname: Help_UserReleaseHelper`, `method: getData`, no params. Returns a map of doc-set prefix to
release, at `actions[0].returnValue.returnValue`. Take the prefix before the first `.` of the article
id, so `platform.code_setting_debug_log_levels.htm` reads the `platform` key.

### Call 2 - the article

`classname: Help_ArticleDataController`, `method: getData`, with:

```json
{
  "articleParameters": {
    "urlName": "platform.code_setting_debug_log_levels.htm",
    "language": "en_US",
    "release": "262.0.0",
    "requestedArticleType": "HelpDocs",
    "requestedArticleTypeNumber": "5"
  }
}
```

`requestedArticleTypeNumber` is the `type` query parameter of the display URL.

The article arrives at `actions[0].returnValue.returnValue.record`, carrying `Title__c`,
`Version__c`, `Content_Length__c` and `Published_Date__c`.

### Joining the content

On a large article `record.Content__c` is a **decoy** holding
`"Cannot populate due to large Document size - N characters."`. The body is split into
`record.Help_Docs_Cache_Details__r[*].Content__c`, in 131072-character chunks, **each wrapped in a
leading and a trailing `.`**. Strip both from every chunk, then join in array order. The result must
equal `Content_Length__c` exactly — that equality is the only check that the join was correct. A
small article puts its content in `Content__c` directly, so handle both shapes.

`record.URL__c` points at the upstream Zoomin CMS
(`zd-ht-prod.zoominsoftware.io/v1/topics/…`), which 404s unauthenticated. The Aura call is the only
way in.

---

## Parsing the event table

Both sources render the same table from the same source, so `scrape.ts` parses them with one
function. They agree on the header row and on nothing else:

| | S1 | S2 |
| --- | --- | --- |
| Column attribute | `data-title` | `data-label` |
| Event name wrapper | `<samp class="codeph nolang">` | `<code>` |
| Rows | 191, some 5 cells wide | 185, all 4 cells |

So find the table by its header row —
`Event Name | Fields or Information Logged with Event | Category Logged | Level Logged` — which
matches exactly one table in each document, then read cells **by position**.

**Do not trust the column attributes.** S1 emits the four `CURSOR_*` rows with an extra empty cell
and assigns the attributes positionally, so `data-title="Category Logged"` lands on the fields text
and `"Level Logged"` lands on the category:

```
[0] data-title="Event Name"              "CURSOR_CREATE_BEGIN"
[1] data-title="Fields or Information …" ""
[2] data-title="Category Logged"         "Line number and SOQL query This event occurs when …"
[3] data-title="Level Logged"            "DB"
[4] data-title="Event Name"              "INFO and above"
```

Dropping the surplus empty cells restores the real column order.

Other things the two renderings do differently:

- S2 states the level as prose — `INFO and above`, and `WARNING` where the log token is `WARN`. Take
  the first token and map the alias.
- Neither page uses the enum tokens. `Category Logged` is a label (`Apex Code`, `DB`), and the
  earlier `Log Category | Description` table in the S2 article spells one of them `Database`.
  So grep `SOQL_EXECUTE_BEGIN` as a smoke test — `APEX_CODE` appears on neither page.
- Six rows carry a parenthetical suffix after the name and repeat an event listed elsewhere with a
  different category, so read the leading `[A-Z][A-Z0-9_]{2,}` token and keep the first row seen.
- S1 leaves raw newlines inside the fields text where S2 has collapsed them. Collapse whitespace on
  every cell, or the two sources appear to disagree on identical content.

## The two sources disagree, and that is expected

S1 leads. As of doc version 262.0 it carries 6 events S2 does not:
`DATA_ACCESS_EVALUATION` and the five `POLICY_RULE_*` events. S2 has never carried anything S1
lacks. `scrape.ts` reports the difference and does not fail on it.
