# Verification design: url-shortener-api

## 1. Scope

Thirty verification blocks, one per approved record of a verifiable template, in spec order.

| template | blocks | ids |
| --- | --- | --- |
| Behavior | 15 | BEH-001 … BEH-015 |
| Scenario | 2 | SCN-001, SCN-002 |
| NFR | 1 | NFR-001 |
| Contract | 6 | CTR-001 … CTR-006 |
| Invariant | 4 | INV-001 … INV-004 |
| Policy | 2 | POL-001, POL-002 |

Skipped, with reason:

- `BL-001` (BrownfieldBaseline), `url-shortener-api` (Partition): baseline and partition metadata, not observable at the boundary.
- `SUR-001` (Surface): container for the member list; its `boundary_type: api` is used only to choose the concrete form of inputs (HTTP method, path, headers, status) and observables.
- `ED-001` (ExternalDependency): the `PORT` variable it describes is verified through BEH-013, BEH-014, BEH-015 and CTR-006.
- `GA-001` (GeneratedArtifact): the build output is verified through NFR-001.
- `CON-001`, `CON-002`, `CON-003` (Constraint): toolchain, storage and no-outbound-fetch constraints; not Boundary/Contract/Invariant/Scenario/NFR/Policy records.
- `OQ-001` … `OQ-007` (Open-Q) and `ASM-001` … `ASM-007` (ASSUMPTION): not requirements. The assumptions in force are used only where a block needs them: ASM-001 for the literal localhost origin in `shortUrl`, ASM-005 for the single 404 fallback, ASM-006 for the `invalid_port` rule, ASM-007 for case-sensitive code lookup.

## 2. Error oracle

### 2.1 Error codes

| error code | observable signal | source record |
| --- | --- | --- |
| `invalid_url` | HTTP 400, JSON body with exactly the field `error` equal to `invalid_url`, no Link created | CTR-001 `error_taxonomy`, BEH-003 |
| `invalid_json` | HTTP 400, JSON body with exactly the field `error` equal to `invalid_json`, process still serving | CTR-001 `error_taxonomy`, BEH-004 |
| `not_found` | HTTP 404, JSON body with exactly the field `error` equal to `not_found`, no `Location` header | CTR-002, CTR-003, CTR-004, CTR-005, BEH-006 … BEH-012 |
| `invalid_port` | process startup ends with a non-zero exit status before a listener is bound, the token `invalid_port` appears in the process error output | CTR-006 `error_taxonomy`, BEH-015, ASM-006 |

### 2.2 Outcome codes

The taxonomies also name the success outcomes. They are not carried in a body field; each names the required status and shape, and blocks use them in a negative oracle when the named failure is a wrong success outcome rather than an error.

| outcome code | observable signal | source record |
| --- | --- | --- |
| `link_created` | HTTP 201 with JSON `code`, `url`, `shortUrl` | CTR-001 |
| `link_already_exists` | HTTP 200 with JSON `code`, `url`, `shortUrl` | CTR-001 |
| `redirect_performed` | HTTP 302 with the `Location` header and no JSON body | CTR-002 |
| `link_stats` | HTTP 200 with JSON `code`, `url`, `hits`, `createdAt` | CTR-003 |
| `link_deleted` | HTTP 204 with no body | CTR-004 |
| `startup_ok` | listener bound to the configured port, `shortUrl` carrying that port | CTR-006 |

## 3. Blocks

### url-shortener-api:BEH-001

```yaml
id: url-shortener-api:BEH-001
template: Behavior
obligation: "POST /links with an absolute http or https url answers 201 with a code matching ^[a-zA-Z0-9]{6}$, echoes url unchanged and leaves one Link whose hit counter is 0."
input_classes:
  - name: typical
    input: "POST /links with body {\"url\":\"https://example.com/a\"} against a process whose in-memory state holds no Link for that url"
    expected: "201 with code of 6 characters from [a-zA-Z0-9], url equal to https://example.com/a and shortUrl equal to http://localhost:<configured port>/<code>"
  - name: empty_state
    input: "POST /links with body {\"url\":\"http://example.org/first\"} as the first request to a freshly started process"
    expected: "201 whose code answers GET /<code> with 302"
  - name: boundary_http_scheme
    input: "POST /links with body {\"url\":\"http://example.com/plain\"}"
    expected: "201 with url echoed as http://example.com/plain and shortUrl http://localhost:<configured port>/<code>"
  - name: boundary_code_shape
    input: "POST /links with body {\"url\":\"https://example.com/shape\"}"
    expected: "201 whose code is exactly 6 characters, every character in [a-zA-Z0-9]"
  - name: invalid_url
    input: "POST /links with body {\"url\":\"ftp://example.com/file\"}"
    expected: "invalid_url; 400"
negative_oracle:
  - input_class: invalid_url
    must_fail_with: "invalid_url"
    must_not: "a 201 response carrying a code field"
assertion_summary:
  - "the status of a valid submission is 201"
  - "the body field code matches ^[a-zA-Z0-9]{6}$"
  - "the body field url equals the submitted string byte for byte"
  - "the body field shortUrl equals http://localhost:<configured port>/<code>"
  - "GET /links/<code> immediately after creation answers 200 with hits equal to 0"
feasibility: feasible
```

### url-shortener-api:BEH-002

```yaml
id: url-shortener-api:BEH-002
template: Behavior
obligation: "Submitting the same original URL a second time answers 200 with the code issued first and leaves exactly one Link whose hit counter is unchanged."
input_classes:
  - name: typical
    input: "POST /links with {\"url\":\"https://example.com/b\"} and then the same body again"
    expected: "201 with code C, then 200 with the same code C"
  - name: empty_state
    input: "POST /links with {\"url\":\"https://example.com/b2\"} on a process holding no Link"
    expected: "201 with a code, establishing the baseline the repeat is compared with"
  - name: boundary_hits_unchanged
    input: "POST /links with {\"url\":\"https://example.com/b3\"}, then GET /<code> twice, then POST /links with the identical body"
    expected: "201, two 302 answers, then 200 with the same code and GET /links/<code> reporting hits equal to 2"
  - name: boundary_identical_payload
    input: "POST /links with the byte-identical body {\"url\":\"https://example.com/b\"} a third time"
    expected: "200 with code C and no new code"
negative_oracle:
  - input_class: typical
    must_fail_with: "link_already_exists"
    must_not: "a 201 status or a second distinct code on the repeated submission"
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a 404 response for a url that is already stored"
assertion_summary:
  - "the first submission answers 201 and the repeat answers 200"
  - "the code of the repeat equals the code of the first submission"
  - "GET /links/<code> after the repeat reports hits equal to the hit count before the repeat"
  - "only one code exists for that url, observed by the repeat answering 200"
feasibility: feasible
```

### url-shortener-api:BEH-003

```yaml
id: url-shortener-api:BEH-003
template: Behavior
obligation: "POST /links with the url key absent, or with an empty, non-string, relative or non-http/https value answers 400 with error invalid_url and leaves the Link count unchanged."
input_classes:
  - name: typical
    input: "POST /links with body {\"url\":\"https://example.com/valid\"}"
    expected: "201 with a code"
  - name: empty_string
    input: "POST /links with body {\"url\":\"\"}"
    expected: "invalid_url; 400"
  - name: boundary_absent_key
    input: "POST /links with body {\"target\":\"https://example.com/a\"}"
    expected: "invalid_url; 400"
  - name: boundary_relative
    input: "POST /links with body {\"url\":\"/a/b\"}"
    expected: "invalid_url; 400"
  - name: boundary_scheme_ftp
    input: "POST /links with body {\"url\":\"ftp://example.com/f\"}"
    expected: "invalid_url; 400"
  - name: invalid_non_string
    input: "POST /links with body {\"url\":123}"
    expected: "invalid_url; 400"
negative_oracle:
  - input_class: empty_string
    must_fail_with: "invalid_url"
    must_not: "a 201 response"
  - input_class: boundary_absent_key
    must_fail_with: "invalid_url"
    must_not: "a 201 response"
  - input_class: boundary_relative
    must_fail_with: "invalid_url"
    must_not: "a 201 response"
  - input_class: boundary_scheme_ftp
    must_fail_with: "invalid_url"
    must_not: "a 201 response"
  - input_class: invalid_non_string
    must_fail_with: "invalid_url"
    must_not: "a 201 response or a 500 response"
assertion_summary:
  - "each invalid body answers 400 with a JSON body holding exactly the field error equal to invalid_url"
  - "no Location header appears on the 400 responses"
  - "a following POST /links with the same value in {\"url\":\"https://example.com/valid\"} still answers 201, so nothing was stored for the invalid submissions"
  - "the process still answers requests after every invalid submission"
feasibility: feasible
```

### url-shortener-api:BEH-004

```yaml
id: url-shortener-api:BEH-004
template: Behavior
obligation: "POST /links with a body that does not parse as JSON answers 400 with error invalid_json, leaves the Link count unchanged and the process keeps serving requests."
input_classes:
  - name: typical
    input: "POST /links with the raw body not-json and no JSON content type"
    expected: "invalid_json; 400"
  - name: empty_body
    input: "POST /links with a zero-length body"
    expected: "invalid_json; 400"
  - name: boundary_truncated
    input: "POST /links with the raw body {\"url\":\"https://example.com/x\""
    expected: "invalid_json; 400"
  - name: valid_contrast
    input: "POST /links with the JSON body {\"url\":\"https://example.com/after\"}"
    expected: "201 with a code, showing the same process still serves valid bodies"
negative_oracle:
  - input_class: typical
    must_fail_with: "invalid_json"
    must_not: "a 500 response, a 400 with invalid_url, or a process exit"
  - input_class: boundary_truncated
    must_fail_with: "invalid_json"
    must_not: "a 500 response or a terminated process"
assertion_summary:
  - "each unparseable body answers 400 with a JSON body holding exactly the field error equal to invalid_json"
  - "the process answers a following valid POST /links with 201"
  - "no code exists for the unparseable body, observed by the following valid submission being a 201"
feasibility: feasible
```

### url-shortener-api:BEH-005

```yaml
id: url-shortener-api:BEH-005
template: Behavior
obligation: "GET /:code for an existing code answers 302 with Location equal to the original URL and no JSON body, and increases the hit counter of that Link by one."
input_classes:
  - name: typical
    input: "create a Link for https://example.com/r then GET /<code> once"
    expected: "302 with Location https://example.com/r and no JSON body"
  - name: empty_state
    input: "GET /<code> as the first redirect of a Link just created for http://example.com/first"
    expected: "302 with Location http://example.com/first and GET /links/<code> reporting hits equal to 1"
  - name: boundary_http_scheme
    input: "create a Link for http://example.com/h then GET /<code>"
    expected: "302 with Location http://example.com/h"
  - name: boundary_second_redirect
    input: "GET /<code> a second time for the same Link"
    expected: "302 with the same Location and GET /links/<code> reporting hits equal to 2"
negative_oracle:
  - input_class: typical
    must_fail_with: "redirect_performed"
    must_not: "a 404 not_found body, a 200 JSON body, or a Location header carrying the short URL"
assertion_summary:
  - "the status of the redirect is 302"
  - "the Location header equals the original URL exactly as submitted"
  - "the response body carries no JSON"
  - "GET /links/<code> before and after a redirect reports hits increased by exactly one"
feasibility: feasible
```

### url-shortener-api:BEH-006

```yaml
id: url-shortener-api:BEH-006
template: Behavior
obligation: "GET /:code for a code that no existing Link carries answers 404 with error not_found and never redirects."
input_classes:
  - name: typical
    input: "GET /Zq9x2B against a process that never issued that code"
    expected: "not_found; 404"
  - name: absent_code
    input: "GET / against a running process"
    expected: "not_found; 404"
  - name: boundary_short_code
    input: "GET /abc12 where no such Link exists"
    expected: "not_found; 404"
  - name: boundary_deleted_code
    input: "create a Link with code C, DELETE /links/C, then GET /C"
    expected: "not_found; 404"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a 302 response or a Location header"
  - input_class: boundary_deleted_code
    must_fail_with: "not_found"
    must_not: "a 302 redirect of a code deleted earlier"
assertion_summary:
  - "every unknown code answers 404 with a JSON body holding exactly the field error equal to not_found"
  - "no Location header appears on those 404 responses"
  - "the body is not empty and does not carry a code, url or hits field"
feasibility: feasible
```

### url-shortener-api:BEH-007

```yaml
id: url-shortener-api:BEH-007
template: Behavior
obligation: "GET /links/:code for an existing code answers 200 with code C, url U, hits equal to the redirect count and createdAt equal to an ISO-8601 representation of the creation instant."
input_classes:
  - name: typical
    input: "create a Link for https://example.com/s then GET /links/<code>"
    expected: "200 with code equal to the issued code, url equal to https://example.com/s, hits equal to 0 and createdAt an ISO-8601 timestamp"
  - name: empty_state
    input: "GET /links/<code> for a Link created as the first write of a freshly started process, before any redirect"
    expected: "200 with hits equal to 0"
  - name: boundary_after_two_redirects
    input: "GET /<code> twice, then GET /links/<code>"
    expected: "200 with hits equal to 2"
  - name: invalid_unknown_code
    input: "GET /links/Zq9x2B where no such Link exists"
    expected: "not_found; 404"
negative_oracle:
  - input_class: invalid_unknown_code
    must_fail_with: "not_found"
    must_not: "a 200 response with an empty or partial body"
assertion_summary:
  - "the status of a known code is 200 and the body holds code, url, hits and createdAt"
  - "hits is a non-negative integer equal to the number of redirects performed"
  - "createdAt parses as an ISO-8601 instant and does not change between two reads"
  - "url equals the original URL exactly as submitted"
feasibility: feasible
```

### url-shortener-api:BEH-008

```yaml
id: url-shortener-api:BEH-008
template: Behavior
obligation: "GET /links/:code for a code no existing Link carries answers 404 with error not_found and serves no statistics."
input_classes:
  - name: typical
    input: "GET /links/Zq9x2B against a process that never issued that code"
    expected: "not_found; 404"
  - name: absent_state
    input: "GET /links/first0 as the first request to a freshly started process"
    expected: "not_found; 404"
  - name: boundary_deleted_code
    input: "create code C, DELETE /links/C, then GET /links/C"
    expected: "not_found; 404"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a 200 response, including a 200 with an empty body"
  - input_class: boundary_deleted_code
    must_fail_with: "not_found"
    must_not: "a 200 body carrying code, url or hits for a deleted Link"
assertion_summary:
  - "the status is 404 and the body holds exactly the field error equal to not_found"
  - "no 200 response with statistics is produced for an unknown or deleted code"
feasibility: feasible
```

### url-shortener-api:BEH-009

```yaml
id: url-shortener-api:BEH-009
template: Behavior
obligation: "DELETE /links/:code for an existing code answers 204 without a JSON body, and a later GET /:code for that code answers 404 with error not_found."
input_classes:
  - name: typical
    input: "create a Link with code C for https://example.com/d then DELETE /links/C"
    expected: "204 with an empty body"
  - name: absent_body_contrast
    input: "DELETE /links/<code> for a Link whose hit counter is 0"
    expected: "204 with no JSON body"
  - name: boundary_redirect_after_deletion
    input: "DELETE /links/C then GET /C"
    expected: "not_found; 404"
  - name: boundary_stats_after_deletion
    input: "DELETE /links/C then GET /links/C"
    expected: "not_found; 404"
negative_oracle:
  - input_class: typical
    must_fail_with: "link_deleted"
    must_not: "a 404 on the first deletion of a known code, or a JSON body on the 204"
  - input_class: boundary_redirect_after_deletion
    must_fail_with: "not_found"
    must_not: "a 302 redirect of the deleted code"
assertion_summary:
  - "the deletion answers 204 with an empty body and no JSON content"
  - "GET /C after the deletion answers 404 with error not_found and no Location header"
  - "GET /links/C after the deletion answers 404 with error not_found"
feasibility: feasible
```

### url-shortener-api:BEH-010

```yaml
id: url-shortener-api:BEH-010
template: Behavior
obligation: "DELETE /links/:code for a code no existing Link carries answers 404 with error not_found, including a repeat deletion of an already deleted code."
input_classes:
  - name: typical
    input: "DELETE /links/Zq9x2B against a process that never issued that code"
    expected: "not_found; 404"
  - name: absent_state
    input: "DELETE /links/first0 as the first request to a freshly started process"
    expected: "not_found; 404"
  - name: boundary_repeated_delete
    input: "create code C, DELETE /links/C, then DELETE /links/C again"
    expected: "not_found; 404 on the second deletion"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a 204 response on deleting a code that was never issued"
  - input_class: boundary_repeated_delete
    must_fail_with: "not_found"
    must_not: "a 204 response on the second deletion of the same code"
assertion_summary:
  - "each deletion of an unknown code answers 404 with a JSON body holding exactly the field error equal to not_found"
  - "the 404 responses carry no other field"
  - "the process still answers requests after the failed deletions"
feasibility: feasible
```

### url-shortener-api:BEH-011

```yaml
id: url-shortener-api:BEH-011
template: Behavior
obligation: "A request whose path no surface member serves answers 404 with error not_found and is not treated as a code lookup."
input_classes:
  - name: typical
    input: "GET /a/b/c/d against a running process"
    expected: "not_found; 404"
  - name: empty_state
    input: "GET /a/b/c/d as the first request to a freshly started process"
    expected: "not_found; 404"
  - name: boundary_trailing_slash
    input: "GET /links/ against a running process"
    expected: "not_found; 404"
  - name: boundary_unsupported_verb_on_statistics_path
    input: "POST /links/abc123 against a running process"
    expected: "not_found; 404"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a 200 response, a 302 redirect, or a 500 response"
  - input_class: boundary_trailing_slash
    must_fail_with: "not_found"
    must_not: "a redirect or a treated-as-code lookup answer"
assertion_summary:
  - "each unmatched path answers 404 with a JSON body holding exactly the field error equal to not_found"
  - "no Location header and no code, url or hits field appears in those responses"
feasibility: feasible
```

### url-shortener-api:BEH-012

```yaml
id: url-shortener-api:BEH-012
template: Behavior
obligation: "A method that no surface member defines for the requested path answers 404 with error not_found and leaves the in-memory state unchanged."
input_classes:
  - name: typical
    input: "PUT /links with body {\"url\":\"https://example.com/m\"}"
    expected: "not_found; 404"
  - name: empty_state
    input: "PUT /links with body {\"url\":\"https://example.com/m\"} against a freshly started process"
    expected: "not_found; 404"
  - name: boundary_undefined_path
    input: "POST /engine with an empty body"
    expected: "not_found; 404"
  - name: boundary_delete_on_collection
    input: "DELETE /links against a running process"
    expected: "not_found; 404"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a 201 response, a 500 response, or a stored Link"
  - input_class: boundary_undefined_path
    must_fail_with: "not_found"
    must_not: "a 405 response or any non-404 status"
assertion_summary:
  - "each unsupported method answers 404 with a JSON body holding exactly the field error equal to not_found"
  - "a subsequent POST /links with the same url still answers 201, so the unsupported method stored nothing"
  - "the process still answers requests afterwards"
feasibility: feasible
```

### url-shortener-api:BEH-013

```yaml
id: url-shortener-api:BEH-013
template: Behavior
obligation: "A process started with PORT set to 4123 answers requests on 4123 and returns shortUrl values containing port 4123."
input_classes:
  - name: typical
    input: "start the process with PORT=4123, then GET /links/unknowncode on port 4123"
    expected: "not_found; 404 from port 4123"
  - name: empty_state
    input: "start the process with PORT=4123 and immediately POST /links with {\"url\":\"https://example.com/p\"} on port 4123"
    expected: "201 with shortUrl equal to http://localhost:4123/<code>"
  - name: boundary_ephemeral_port
    input: "start the process with PORT set to a free port chosen by the test, then request that port"
    expected: "the request is answered and shortUrl carries the chosen port"
  - name: absent_on_default_port
    input: "request GET /links/unknowncode on port 3000 while the process was started with PORT=4123"
    expected: "no answer on port 3000 from that process"
negative_oracle:
  - input_class: typical
    must_fail_with: "startup_ok"
    must_not: "an answer on port 3000 from the same process, or a shortUrl containing :3000"
assertion_summary:
  - "the request to the configured port is answered with 404 and error not_found"
  - "the body field shortUrl equals http://localhost:4123/<code>"
  - "no listener of that process answers on port 3000"
feasibility: feasible
```

### url-shortener-api:BEH-014

```yaml
id: url-shortener-api:BEH-014
template: Behavior
obligation: "A process started without the PORT variable accepts requests on port 3000 and returns shortUrl values containing port 3000."
input_classes:
  - name: typical
    input: "start the process with the PORT variable absent from its environment, then request GET /links/unknowncode on port 3000"
    expected: "not_found; 404 from port 3000"
  - name: empty_state
    input: "start the process without PORT and POST /links with {\"url\":\"https://example.com/default\"} on port 3000"
    expected: "201 with shortUrl equal to http://localhost:3000/<code>"
  - name: boundary_explicit_default
    input: "start the process with PORT=3000 and request GET /links/unknowncode on port 3000"
    expected: "not_found; 404 with shortUrl values containing :3000"
negative_oracle:
  - input_class: typical
    must_fail_with: "startup_ok"
    must_not: "a process that exits before binding, or a listener on a port other than 3000"
assertion_summary:
  - "the process with PORT absent stays running and answers on port 3000"
  - "the answer to GET /links/unknowncode on port 3000 is 404 with error not_found"
  - "the body field shortUrl equals http://localhost:3000/<code>"
feasibility: feasible
```

### url-shortener-api:BEH-015

```yaml
id: url-shortener-api:BEH-015
template: Behavior
obligation: "A process started with PORT set to a value that is not a port number exits with a non-zero status and reports error code invalid_port without binding a listener."
input_classes:
  - name: typical
    input: "start the process with PORT=abc"
    expected: "non-zero exit status and the token invalid_port in the process error output"
  - name: valid_contrast
    input: "start the process with PORT=4123"
    expected: "the process stays running and answers on 4123"
  - name: boundary_out_of_range
    input: "start the process with PORT=70000"
    expected: "non-zero exit status and the token invalid_port in the process error output"
  - name: invalid_non_numeric
    input: "start the process with PORT=abc"
    expected: "non-zero exit status, no listener bound"
negative_oracle:
  - input_class: invalid_non_numeric
    must_fail_with: "invalid_port"
    must_not: "a running process that answers requests on any port, or a silent fallback to port 3000"
  - input_class: boundary_out_of_range
    must_fail_with: "invalid_port"
    must_not: "a listener bound to port 70000 or to a substitute port"
assertion_summary:
  - "the exit status of the started process is non-zero"
  - "the process error output contains the token invalid_port"
  - "no request is answered on port 3000 after the failed startup"
feasibility: feasible
```

### url-shortener-api:SCN-001

```yaml
id: url-shortener-api:SCN-001
template: Scenario
obligation: "The seven requests of the Link lifecycle produce exactly the listed statuses, the Location header of each redirect, hits 2 after two redirects and not_found after deletion."
input_classes:
  - name: typical
    input: "the seven requests of observable_sequence against one process listening on a test-chosen port"
    expected: "201, 302, 302, 200 with hits 2, 204, 404 not_found, 404 not_found in that order"
  - name: empty_state
    input: "the same sequence against a freshly started process holding no Link"
    expected: "the same seven statuses, the first POST answering 201"
  - name: boundary_post_deletion_lookups
    input: "GET /C and GET /links/C after the 204"
    expected: "not_found; 404 for both"
negative_oracle:
  - input_class: boundary_post_deletion_lookups
    must_fail_with: "not_found"
    must_not: "a 302 redirect or a 200 statistics body for the deleted code"
observable_sequence:
  - "POST /links with {\"url\":\"https://example.com/lifecycle\"} → 201 with code C"
  - "GET /C → 302 with Location https://example.com/lifecycle"
  - "GET /C → 302 with Location https://example.com/lifecycle"
  - "GET /links/C → 200 with hits 2"
  - "DELETE /links/C → 204 with an empty body"
  - "GET /C → 404 with error not_found"
  - "GET /links/C → 404 with error not_found"
assertion_summary:
  - "the seven responses carry the listed statuses in the listed order"
  - "both redirects carry Location equal to https://example.com/lifecycle"
  - "the statistics read reports hits equal to 2 and not 1"
  - "the two post-deletion requests carry error not_found and no hits field"
feasibility: feasible
```

### url-shortener-api:SCN-002

```yaml
id: url-shortener-api:SCN-002
template: Scenario
obligation: "Three submissions of one url, interleaved with a redirect, yield one code, one Link and an unchanged hit counter of 1."
input_classes:
  - name: typical
    input: "the six requests of observable_sequence for https://example.com/dup"
    expected: "201, 302, 200 with code C, 200 with hits 1, 200 with code C, 200 with hits 1"
  - name: empty_state
    input: "the same sequence against a freshly started process holding no Link"
    expected: "the first submission answers 201 and every later submission answers 200 with code C"
  - name: boundary_identical_payload
    input: "the byte-identical body {\"url\":\"https://example.com/dup\"} sent three times"
    expected: "201 then 200 then 200, all three carrying the same code"
negative_oracle:
  - input_class: typical
    must_fail_with: "link_already_exists"
    must_not: "a 201 status or a new code on the second and third submission"
observable_sequence:
  - "POST /links with {\"url\":\"https://example.com/dup\"} → 201 with code C"
  - "GET /C → 302"
  - "POST /links with {\"url\":\"https://example.com/dup\"} → 200 with code C"
  - "GET /links/C → 200 with hits 1"
  - "POST /links with {\"url\":\"https://example.com/dup\"} → 200 with code C"
  - "GET /links/C → 200 with hits 1"
assertion_summary:
  - "the six responses carry the listed statuses in the listed order"
  - "all three submissions return the same code C"
  - "hits stays 1 after the repeated submissions"
feasibility: feasible
```

### url-shortener-api:NFR-001

```yaml
id: url-shortener-api:NFR-001
template: NFR
obligation: "The build command exits 0 and the test command exits 0 with no failing test and no skipped case."
input_classes:
  - name: typical
    input: "run the documented build command on a clean checkout, then the documented test command"
    expected: "both commands exit 0 and the test output reports no failing and no skipped case"
  - name: empty_state
    input: "run the build command and the test command after a fresh dependency install with no build output present"
    expected: "both commands exit 0"
  - name: boundary_failing_counts
    input: "the test output of the full suite run"
    expected: "the reported counts of failing and skipped cases are both 0"
negative_oracle:
  - input_class: boundary_failing_counts
    must_fail_with: "UNDEFINED_CODE"
    must_not: "a suite whose reported output lists a skipped or a failing case, or a non-zero exit status"
assertion_summary:
  - "the build command exit status is 0"
  - "the test command exit status is 0"
  - "the test output reports zero failing cases and zero skipped cases"
feasibility: infeasible_candidate
infeasibility_reason: "the aggregate outcome of the whole test suite cannot be observed deterministically from inside a test that is itself part of that suite, and the record assigns no error code to a suite containing skipped cases"
```

### url-shortener-api:CTR-001

```yaml
id: url-shortener-api:CTR-001
template: Contract
obligation: "POST /links answers 201 with code, url and shortUrl for a valid url, 200 with the same code for a repeated url, and 400 with the documented error code for invalid or unparseable input."
input_classes:
  - name: typical
    input: "POST /links with body {\"url\":\"https://example.com/c1\"}"
    expected: "201 with fields code matching ^[a-zA-Z0-9]{6}$, url equal to https://example.com/c1, shortUrl equal to http://localhost:<configured port>/<code>"
  - name: empty_state
    input: "POST /links with body {\"url\":\"https://example.com/c2\"} on a process holding no Link"
    expected: "201 with the three documented fields and no additional field"
  - name: boundary_repeated_url
    input: "POST /links with the same body {\"url\":\"https://example.com/c1\"} again"
    expected: "200 with the same code, url and shortUrl"
  - name: invalid_url
    input: "POST /links with body {\"url\":\"example.com/no-scheme\"}"
    expected: "invalid_url; 400"
  - name: invalid_json
    input: "POST /links with the raw body not-json"
    expected: "invalid_json; 400"
negative_oracle:
  - input_class: invalid_url
    must_fail_with: "invalid_url"
    must_not: "a 400 body carrying an undocumented error code or free text"
  - input_class: invalid_json
    must_fail_with: "invalid_json"
    must_not: "a 400 body carrying invalid_url where invalid_json is required, or a 500 response"
assertion_summary:
  - "the 201 and 200 responses carry exactly the fields code, url and shortUrl"
  - "shortUrl equals http://localhost:<configured port>/ concatenated with code"
  - "every 400 body holds exactly the field error whose value is a code from the contract taxonomy"
  - "no response of this contract carries an undocumented code"
feasibility: feasible
```

### url-shortener-api:CTR-002

```yaml
id: url-shortener-api:CTR-002
template: Contract
obligation: "GET /:code answers 302 with Location equal to the original URL for a known code and 404 with error not_found for an unknown or deleted code."
input_classes:
  - name: typical
    input: "create a Link for https://example.com/g1, then GET /<code>"
    expected: "302 with Location https://example.com/g1 and no JSON body"
  - name: empty_state
    input: "GET /<code> for the first Link created on a freshly started process"
    expected: "302 with Location equal to that Link's original URL"
  - name: boundary_deleted_code
    input: "DELETE /links/<code> then GET /<code>"
    expected: "not_found; 404"
  - name: invalid_unknown_code
    input: "GET /Zq9x2B where no such Link exists"
    expected: "not_found; 404"
negative_oracle:
  - input_class: invalid_unknown_code
    must_fail_with: "not_found"
    must_not: "a 302 response or a Location header"
  - input_class: boundary_deleted_code
    must_fail_with: "not_found"
    must_not: "a redirect of a code deleted earlier"
assertion_summary:
  - "the redirect status is 302 and the Location header equals the original URL byte for byte"
  - "the 302 body carries no JSON"
  - "the 404 body holds exactly the field error equal to not_found"
  - "the Location header never carries the short URL"
feasibility: feasible
```

### url-shortener-api:CTR-003

```yaml
id: url-shortener-api:CTR-003
template: Contract
obligation: "GET /links/:code answers 200 with the four documented fields for a known code and 404 with error not_found for an unknown code."
input_classes:
  - name: typical
    input: "create a Link for https://example.com/s1, then GET /links/<code>"
    expected: "200 with code, url, hits as a number and createdAt as an ISO-8601 string"
  - name: empty_state
    input: "GET /links/<code> before any redirect of that Link"
    expected: "200 with hits equal to 0"
  - name: boundary_after_redirects
    input: "GET /<code> twice, then GET /links/<code>"
    expected: "200 with hits equal to 2"
  - name: invalid_unknown_code
    input: "GET /links/Zq9x2B where no such Link exists"
    expected: "not_found; 404"
negative_oracle:
  - input_class: invalid_unknown_code
    must_fail_with: "not_found"
    must_not: "a 200 response, or a 404 body carrying fields other than error"
assertion_summary:
  - "the 200 body carries exactly the fields code, url, hits and createdAt"
  - "hits is a non-negative integer and createdAt parses as an ISO-8601 instant"
  - "every 404 body holds exactly the field error equal to not_found"
feasibility: feasible
```

### url-shortener-api:CTR-004

```yaml
id: url-shortener-api:CTR-004
template: Contract
obligation: "DELETE /links/:code answers 204 with no body for a known code and 404 with error not_found for an unknown code, and a deleted code stops redirecting immediately."
input_classes:
  - name: typical
    input: "create a Link with code C, then DELETE /links/C"
    expected: "204 with an empty body"
  - name: empty_state
    input: "DELETE /links/<code> for the only Link of a freshly started process"
    expected: "204 with an empty body"
  - name: boundary_deleted_then_redirect
    input: "DELETE /links/C then GET /C immediately"
    expected: "not_found; 404"
  - name: invalid_unknown_code
    input: "DELETE /links/Zq9x2B where no such Link exists"
    expected: "not_found; 404"
negative_oracle:
  - input_class: invalid_unknown_code
    must_fail_with: "not_found"
    must_not: "a 204 response for a code that was not issued"
  - input_class: boundary_deleted_then_redirect
    must_fail_with: "not_found"
    must_not: "a 302 redirect after the deletion"
assertion_summary:
  - "the deletion status is 204 and its body is empty"
  - "the 404 body holds exactly the field error equal to not_found"
  - "the redirect of a deleted code answers 404 with no Location header"
feasibility: feasible
```

### url-shortener-api:CTR-005

```yaml
id: url-shortener-api:CTR-005
template: Contract
obligation: "A request that no surface member matches answers 404 with error not_found and changes no state."
input_classes:
  - name: typical
    input: "GET /a/b/c/d against a running process"
    expected: "not_found; 404"
  - name: empty_state
    input: "GET /a/b/c/d as the first request to a freshly started process"
    expected: "not_found; 404"
  - name: boundary_unmatched_method
    input: "PUT /links with body {\"url\":\"https://example.com/u\"}"
    expected: "not_found; 404"
  - name: invalid_redirect_shape
    input: "GET /engine against a running process"
    expected: "not_found; 404"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a 500 response, a 302 redirect, or a 200 response"
  - input_class: boundary_unmatched_method
    must_fail_with: "not_found"
    must_not: "a 405 response or a stored Link"
assertion_summary:
  - "every unmatched request answers 404 with a JSON body holding exactly the field error equal to not_found"
  - "no Location header accompanies those responses"
  - "a following POST /links with the same url answers 201, so the unmatched request stored nothing"
feasibility: feasible
```

### url-shortener-api:CTR-006

```yaml
id: url-shortener-api:CTR-006
template: Contract
obligation: "The process listens on the port given by PORT, falls back to port 3000 when PORT is absent, and exits non-zero with invalid_port when PORT is not a port number."
input_classes:
  - name: typical
    input: "start the process with PORT=4123 and request GET /links/unknowncode on port 4123"
    expected: "not_found; 404, and shortUrl values containing :4123"
  - name: empty_state
    input: "start the process with the PORT variable absent and request GET /links/unknowncode on port 3000"
    expected: "not_found; 404, and shortUrl values containing :3000"
  - name: boundary_ephemeral_port
    input: "start the process with PORT set to a free port chosen by the test"
    expected: "requests on the chosen port are answered and shortUrl carries the chosen port"
  - name: invalid_port_value
    input: "start the process with PORT=abc"
    expected: "invalid_port; non-zero exit status"
negative_oracle:
  - input_class: invalid_port_value
    must_fail_with: "invalid_port"
    must_not: "a listener bound to any port, or a silent fallback to port 3000"
assertion_summary:
  - "the listener port equals the configured port and appears unchanged in shortUrl"
  - "with PORT absent the listener port is 3000"
  - "with PORT=abc the exit status is non-zero and the process error output contains invalid_port"
feasibility: feasible
```

### url-shortener-api:INV-001

```yaml
id: url-shortener-api:INV-001
template: Invariant
obligation: "After a restart the in-memory state is empty, so every code issued before the restart answers 404 with error not_found."
input_classes:
  - name: typical
    input: "create two Links, stop the process, start it again on the same port, then GET /<code> for both codes"
    expected: "not_found; 404 for both codes"
  - name: empty_state
    input: "restart the process and immediately GET /links/unknowncode"
    expected: "not_found; 404"
  - name: boundary_after_deletions
    input: "create three Links, delete one, restart, then read the statistics of the remaining codes"
    expected: "not_found; 404 for every code, deleted or not"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a 302 redirect or a 200 statistics body for any code issued before the restart"
assertion_summary:
  - "every code issued before the restart answers 404 with error not_found afterwards"
  - "no data file appears in the working directory of the process"
  - "the restarted process answers new submissions with 201"
feasibility: feasible
```

### url-shortener-api:INV-002

```yaml
id: url-shortener-api:INV-002
template: Invariant
obligation: "Every issued code is exactly 6 characters long, each from [a-zA-Z0-9], and no two existing Links share a code."
input_classes:
  - name: typical
    input: "create five Links for five distinct urls and read the code of each"
    expected: "five codes, each matching ^[a-zA-Z0-9]{6}$, all pairwise distinct"
  - name: empty_state
    input: "read the code of the first Link of a freshly started process"
    expected: "a code matching ^[a-zA-Z0-9]{6}$"
  - name: boundary_many_back_to_back
    input: "create 200 Links for 200 distinct urls without intervening requests"
    expected: "200 codes, each matching ^[a-zA-Z0-9]{6}$, all pairwise distinct"
negative_oracle:
  - input_class: boundary_many_back_to_back
    must_fail_with: "UNDEFINED_CODE"
    must_not: "a code of length other than 6, a code containing a character outside [a-zA-Z0-9], or two urls answering with one code"
assertion_summary:
  - "every returned code matches ^[a-zA-Z0-9]{6}$"
  - "the set of returned codes has the same size as the number of distinct urls submitted"
  - "each code resolves to its own original URL through GET /:code"
feasibility: feasible
```

### url-shortener-api:INV-003

```yaml
id: url-shortener-api:INV-003
template: Invariant
obligation: "Every error response has a JSON body holding exactly one field named error whose value is a stable snake_case code from the responding contract, never free text."
input_classes:
  - name: typical
    input: "GET /Zq9x2B where no such Link exists"
    expected: "not_found; 404"
  - name: empty_state
    input: "POST /links with a zero-length body on a freshly started process"
    expected: "invalid_json; 400"
  - name: boundary_validation_error
    input: "POST /links with body {\"url\":\"/relative\"}"
    expected: "invalid_url; 400"
  - name: boundary_lookup_error
    input: "DELETE /links/Zq9x2B where no such Link exists"
    expected: "not_found; 404"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "a body whose error value is a sentence, or a body carrying a second field"
  - input_class: boundary_validation_error
    must_fail_with: "invalid_url"
    must_not: "a body whose error value is free text or an unlisted code"
assertion_summary:
  - "every error body parses as JSON"
  - "every error body has exactly one key, named error"
  - "every error value matches ^[a-z][a-z0-9_]*$ and appears in section 2"
feasibility: feasible
```

### url-shortener-api:INV-004

```yaml
id: url-shortener-api:INV-004
template: Invariant
obligation: "Every JSON response carries Content-Type application/json, while the 302 redirect and the 204 deletion carry no JSON body."
input_classes:
  - name: typical
    input: "POST /links with body {\"url\":\"https://example.com/ct\"} then GET /links/<code>"
    expected: "both responses carry Content-Type application/json and a JSON body"
  - name: empty_state
    input: "GET /links/unknowncode on a freshly started process"
    expected: "Content-Type application/json on the 404 response"
  - name: boundary_error_responses
    input: "POST /links with body {\"url\":\"/relative\"}"
    expected: "400 carrying Content-Type application/json"
  - name: boundary_no_json_body
    input: "create a Link, GET /<code>, then DELETE /links/<code>"
    expected: "302 and 204, neither carrying a JSON body"
negative_oracle:
  - input_class: boundary_no_json_body
    must_fail_with: "redirect_performed"
    must_not: "a JSON body or a Content-Type application/json on the 302 redirect or the 204 deletion"
  - input_class: typical
    must_fail_with: "link_created"
    must_not: "a 201 response without a Content-Type header naming application/json"
assertion_summary:
  - "the 200 and 201 responses carry Content-Type application/json"
  - "the 400 and 404 responses carry Content-Type application/json"
  - "the 302 and 204 responses carry no JSON body"
feasibility: feasible
```

### url-shortener-api:POL-001

```yaml
id: url-shortener-api:POL-001
template: Policy
obligation: "Every error response parses as JSON, carries exactly the field error, and its value is a code from section 2; no error response carries free text and no success response carries an error field."
input_classes:
  - name: typical_validation_error
    input: "POST /links with body {\"url\":\"/relative\"}"
    expected: "invalid_url; 400"
  - name: typical_lookup_error
    input: "GET /Zq9x2B where no such Link exists"
    expected: "not_found; 404"
  - name: empty_body_error
    input: "POST /links with a zero-length body"
    expected: "invalid_json; 400"
  - name: boundary_unmatched_request
    input: "PUT /links with body {\"url\":\"https://example.com/pol\"}"
    expected: "not_found; 404"
negative_oracle:
  - input_class: typical_validation_error
    must_fail_with: "invalid_url"
    must_not: "a body holding a human-readable message, or a body holding a key beside error"
  - input_class: typical_lookup_error
    must_fail_with: "not_found"
    must_not: "a 404 body whose error value is not in section 2"
assertion_summary:
  - "every collected error body parses as JSON with exactly one key named error"
  - "every error value is one of invalid_url, invalid_json, not_found"
  - "no success body carries an error field"
feasibility: feasible
```

### url-shortener-api:POL-002

```yaml
id: url-shortener-api:POL-002
template: Policy
obligation: "After any invalid request, including a malformed body, an invalid url, an unknown route or an unsupported method, the process answers a following valid request."
input_classes:
  - name: typical_malformed_body
    input: "POST /links with the raw body not-json, then POST /links with {\"url\":\"https://example.com/ok\"}"
    expected: "invalid_json; 400, then 201 with a code"
  - name: empty_body
    input: "POST /links with a zero-length body, then GET /links/unknowncode"
    expected: "invalid_json; 400, then not_found; 404"
  - name: invalid_url
    input: "POST /links with body {\"url\":\"ftp://example.com/f\"}, then POST /links with {\"url\":\"https://example.com/after\"}"
    expected: "invalid_url; 400, then 201 with a code"
  - name: unmatched_route
    input: "GET /a/b/c/d, then GET /links/unknowncode"
    expected: "not_found; 404 twice, with the process still answering"
  - name: unsupported_method
    input: "PUT /links with body {\"url\":\"https://example.com/state\"}, then GET /links/unknowncode"
    expected: "not_found; 404 twice, and no Link stored for https://example.com/state"
negative_oracle:
  - input_class: typical_malformed_body
    must_fail_with: "invalid_json"
    must_not: "a terminated process, an unhandled error response without a code, or a following valid request that goes unanswered"
  - input_class: unsupported_method
    must_fail_with: "not_found"
    must_not: "a change of the in-memory state visible in a following statistics read"
assertion_summary:
  - "each invalid request is answered with a 4xx status carrying a code from section 2"
  - "the request following the invalid one receives 201 or 404 as described, never a connection failure"
  - "no stack trace or free text appears in any response body"
feasibility: feasible
```

## 4. Infeasible candidates

| id | reason | what would make it feasible |
| --- | --- | --- |
| `url-shortener-api:NFR-001` | the aggregate outcome of the whole build and the whole test suite cannot be observed deterministically from inside a test that is itself part of that suite; the record also assigns no error code to a suite containing skipped cases, so its negative oracle carries `UNDEFINED_CODE` | a verification step outside the suite (a pipeline stage) that runs the build and the test commands and records their exit statuses and case counts |
| `url-shortener-api:INV-002` | not blocked as a predicate: the shape and uniqueness obligation is decidable from the returned codes. The record's negative cases (wrong code length, character outside the alphabet, two Links sharing a code) are violations for which the spec assigns no error code, so the negative oracle carries `UNDEFINED_CODE` | a spec-assigned error code for a code-shape or uniqueness violation, which would let the oracle name the code instead of `UNDEFINED_CODE` |
