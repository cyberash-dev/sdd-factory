# Verification design: box-office

## 1. Scope

Every approved record of template Behavior, Contract, Invariant, Scenario or Policy carries exactly one block, in spec order. The boundary is the HTTP JSON API of `box-office:SUR-001` (`boundary_type: api`): every input class is one HTTP request (method, path, headers, body, query) and every expected observable is a response status plus its JSON body, or the state that a later named request reveals.

Block counts per template:

- Behavior: 31 blocks (`box-office:BEH-001` … `box-office:BEH-031`)
- Scenario: 4 blocks (`box-office:SCN-001` … `box-office:SCN-004`)
- Contract: 15 blocks (`box-office:CTR-001` … `box-office:CTR-015`)
- Invariant: 11 blocks (`box-office:INV-001` … `box-office:INV-011`)
- Policy: 2 blocks (`box-office:POL-001`, `box-office:POL-002`)

Total: 63 blocks.

IDs skipped and why:

- `box-office` (Partition) — the baseline and the partition record are not verifiable obligations.
- `box-office:BL-001` (BrownfieldBaseline) — the brownfield baseline is not a normative record.
- `box-office:SUR-001` (Surface): its `boundary_type: api` and its member list shape every block but the Surface itself carries no block.
- `box-office:CST-001` … `box-office:CST-005` (Constraint): Constraints are excluded by the block rule. Their testable content is nevertheless observable and appears where a Behavior references it: the hold lifetime `HOLD_SECONDS` in `box-office:BEH-014`, `box-office:SCN-001` and `box-office:SCN-004`; the `PORT`-served listener as the precondition of every block.
- `box-office:OQ-001` … `box-office:OQ-011` (Open-Q): questions, not obligations. Their readings reach the blocks through the Behavior and Contract records that state them.
- `box-office:ASM-001` … `box-office:ASM-019` (ASSUMPTION): excluded by the block rule; the readings they record are the readings the Behavior and Contract blocks state.

Two boundary classes named by a record are not reproduced as input classes because they cannot be constructed deterministically from the boundary: the instant exactly 24 hours away (`box-office:BEH-020`, `box-office:CTR-010`, bracketed by a 25-hour and a 23-hour class) and `startsAt` exactly a millisecond in the future (`box-office:BEH-007`) or exactly now (`box-office:BEH-016`), both bracketed by a clearly future and a clearly past class. Both omissions are logged in the handoff.

## 2. Error oracle

No message text is a contract: `box-office:POL-001` states that the message is free, so the only message-level observable is the presence of the key `error` with a non-empty string value in a JSON object body. Every failure below therefore has the signal `status` + `body is a JSON object with key "error"`.

| Error code | Observable signal | Source record |
| --- | --- | --- |
| `E_MALFORMED_JSON` | 400; body `{"error": "<message>"}` | `box-office:CTR-001`, `CTR-002`, `CTR-004`, `CTR-008`, `CTR-013`, `CTR-014`, `BEH-005`, `BEH-030`, `BEH-031` |
| `E_INVALID_INPUT` | 400; body with key `error` | `box-office:CTR-001`, `CTR-002`, `CTR-004`, `CTR-008`, `CTR-013`, `CTR-014` |
| `E_EMAIL_TAKEN` | 409; body with key `error` | `box-office:CTR-001` |
| `E_UNAUTHENTICATED` | 401; body with key `error`, no token, no account data | `box-office:CTR-003`, `CTR-004`, `CTR-007` … `CTR-015` |
| `E_FORBIDDEN` | 403; body with key `error` | `box-office:CTR-004`, `CTR-007`, `CTR-008`, `CTR-009`, `CTR-010`, `CTR-012`, `CTR-013`, `CTR-014`, `CTR-015` |
| `E_NOT_FOUND` | 404; body with key `error` | `box-office:CTR-006`, `CTR-007`, `CTR-008`, `CTR-009`, `CTR-010`, `CTR-011`, `CTR-013`, `CTR-014`, `CTR-015`, `BEH-030`, `BEH-031` |
| `E_INVALID_QUERY` | 400; body with key `error` | `box-office:CTR-005` |
| `E_INVALID_TIER` | 400; body with key `error` | `box-office:CTR-008`, `CTR-014` |
| `E_EVENT_NOT_ON_SALE` | 409; body with key `error` | `box-office:CTR-008` |
| `E_TICKETS_UNAVAILABLE` | 409; body with key `error` | `box-office:CTR-008` |
| `E_TICKET_LIMIT` | 422; body with key `error` | `box-office:CTR-008` |
| `E_DISCOUNT_UNUSABLE` | 422; body with key `error` | `box-office:CTR-008` |
| `E_ORDER_STATE` | 409; body with key `error` | `box-office:CTR-009`, `CTR-010` |
| `E_EVENT_CANCELLED` | 409; body with key `error` | `box-office:CTR-007` |
| `E_TICKETS_AVAILABLE` | 409; body with key `error` | `box-office:CTR-014` |
| `E_ALREADY_WAITING` | 409; body with key `error` | `box-office:CTR-014` |
| `E_CODE_TAKEN` | 409; body with key `error` | `box-office:CTR-013` |

Every success status is decided by the record itself: 200, 201 as each Block states. A status outside 400, 401, 403, 404, 409, 422 on a failed request is itself a violation (`box-office:POL-001`, `box-office:INV-008`).

## 3. Blocks

### box-office:BEH-001

```yaml
id: box-office:BEH-001
template: Behavior
obligation: "a valid POST /users answers 201 with id, email, name and role, the body carries no password, and GET /me with a token of that account returns the same four fields"
input_classes:
  - name: typical_organizer
    input: "POST /users with body {\"email\": \"ada@example.com\", \"password\": \"correct-horse\", \"name\": \"Ada\", \"role\": \"organizer\"}"
    expected: "201 with a JSON object holding id, email, name and role; email is \"ada@example.com\", name is \"Ada\", role is \"organizer\", id is a non-empty string; the body carries no key whose value equals \"correct-horse\"; POST /sessions with the same email and password answers 200 and GET /me with that token returns the same id, email, name and role"
  - name: typical_customer
    input: "POST /users with body {\"email\": \"bo@example.com\", \"password\": \"12345678\", \"name\": \"Bo\", \"role\": \"customer\"}"
    expected: "201 with role \"customer\" and the submitted email and name"
  - name: empty_no_account_yet
    input: "POST /users with body {} on a fresh process"
    expected: "400 E_INVALID_INPUT with a body carrying the key error, and POST /sessions with any email and password answers 401 E_UNAUTHENTICATED"
  - name: invalid_duplicate_email_case
    input: "POST /users with email \"ada@example.com\" after that email was registered, then POST /users with email \"Ada@Example.com\" and password \"another-pass\""
    expected: "the second call answers 409 E_EMAIL_TAKEN with a body carrying the key error"
negative_oracle:
  - input_class: invalid_duplicate_email_case
    must_fail_with: "E_EMAIL_TAKEN"
    must_not: "a 201 body for the second call, and a token for the second email, since POST /sessions with \"Ada@Example.com\" and \"another-pass\" answers 401"
assertion_summary:
  - "the 201 body is a JSON object whose keys are exactly id, email, name, role"
  - "email, name and role of the 201 body equal the submitted values character for character"
  - "id is a JSON string, not a number"
  - "GET /me with a token of that account returns the same id, email, name and role"
  - "no response body of this block contains the submitted password string"
feasibility: feasible
```

### box-office:BEH-002

```yaml
id: box-office:BEH-002
template: Behavior
obligation: "each out-of-rule field of POST /users yields 400 E_INVALID_INPUT and creates no account for that email"
input_classes:
  - name: typical
    input: "POST /users with body {\"email\": \"a@b.co\", \"password\": \"12345678\", \"name\": \"Ada\", \"role\": \"organizer\"}"
    expected: "201 with id, email, name and role"
  - name: boundary_password_8
    input: "POST /users with password of exactly 8 characters, otherwise valid"
    expected: "201"
  - name: invalid_password_7
    input: "POST /users with password of exactly 7 characters, otherwise valid"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
  - name: boundary_name_100
    input: "POST /users with name of exactly 100 characters, otherwise valid"
    expected: "201"
  - name: invalid_name_101
    input: "POST /users with name of exactly 101 characters, otherwise valid"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_name_empty
    input: "POST /users with name \"\" (0 characters), otherwise valid"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_email_without_dot_after_at
    input: "POST /users with email \"ada@exampleco\" (an @ but no . after it), otherwise valid"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_role
    input: "POST /users with role \"admin\", otherwise valid"
    expected: "400 E_INVALID_INPUT"
  - name: empty_body
    input: "POST /users with body {}"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_body_not_json
    input: "POST /users with body not-json-at-all"
    expected: "400 E_MALFORMED_JSON with a body carrying the key error"
negative_oracle:
  - input_class: invalid_password_7
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body for that email, and a token, since POST /sessions with that email and the 7-character password answers 401"
  - input_class: invalid_body_not_json
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "any account created, observable as a later POST /users for the email carried in the malformed text answering 400 rather than 409"
assertion_summary:
  - "every rejection body is a JSON object carrying the key error"
  - "no rejection body contains id, email, name or role of a created account"
  - "the rejection writes nothing: a later POST /users with the same email and a valid body answers 201"
feasibility: feasible
```

### box-office:BEH-003

```yaml
id: box-office:BEH-003
template: Behavior
obligation: "a case-different duplicate email yields 409 E_EMAIL_TAKEN and leaves the account count unchanged"
input_classes:
  - name: typical_new_email
    input: "POST /users with email \"bob@example.com\" after \"ada@example.com\" was registered"
    expected: "201 with id, email, name and role"
  - name: invalid_identical_email
    input: "POST /users with email \"ada@example.com\" again"
    expected: "409 E_EMAIL_TAKEN with a body carrying the key error"
  - name: invalid_case_different_email
    input: "POST /users with email \"Ada@Example.com\" after \"ada@example.com\" was registered"
    expected: "409 E_EMAIL_TAKEN with a body carrying the key error"
  - name: empty_body
    input: "POST /users with body {}"
    expected: "400 E_INVALID_INPUT"
negative_oracle:
  - input_class: invalid_case_different_email
    must_fail_with: "E_EMAIL_TAKEN"
    must_not: "a 201 body and any account for that case-different email, observable as POST /sessions with \"Ada@Example.com\" and the submitted password answering 401"
  - input_class: invalid_identical_email
    must_fail_with: "E_EMAIL_TAKEN"
    must_not: "a second id in any 201 body"
assertion_summary:
  - "the 409 body is a JSON object carrying the key error and no account fields"
  - "after the 409, POST /sessions with \"ada@example.com\" and that account's password still answers 200, so the first account survived"
  - "after the 409, POST /sessions with \"Ada@Example.com\" and the rejected password answers 401"
feasibility: feasible
```

### box-office:BEH-004

```yaml
id: box-office:BEH-004
template: Behavior
obligation: "a matching email and password pair answers 200 with a usable non-empty token, and a wrong password or an unregistered email answers 401 with no token"
input_classes:
  - name: typical_matching_pair
    input: "POST /sessions with {\"email\": \"ada@example.com\", \"password\": \"correct-horse\"} for a registered account"
    expected: "200 with a JSON object whose token is a non-empty string; GET /me with Authorization: Bearer <token> answers 200 with that account's id, email, name and role"
  - name: empty_missing_email
    input: "POST /sessions with {\"password\": \"correct-horse\"}"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
  - name: invalid_wrong_password
    input: "POST /sessions with {\"email\": \"ada@example.com\", \"password\": \"wrong-horse\"}"
    expected: "401 E_UNAUTHENTICATED with a body carrying the key error"
  - name: invalid_unregistered_email
    input: "POST /sessions with {\"email\": \"nobody@example.com\", \"password\": \"correct-horse\"}"
    expected: "401 E_UNAUTHENTICATED with a body carrying the key error"
negative_oracle:
  - input_class: invalid_wrong_password
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a key named token in the response body"
  - input_class: invalid_unregistered_email
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 200 status and a token"
assertion_summary:
  - "the 200 body is a JSON object whose token value is a non-empty JSON string"
  - "neither 401 body carries a token key nor any account field"
  - "the token is accepted on a protected route afterwards, so it was issued for that account"
feasibility: feasible
```

### box-office:BEH-005

```yaml
id: box-office:BEH-005
template: Behavior
obligation: "a served route and method with a malformed body answers 400 before the token check, a missing or unissued token answers 401 before every remaining endpoint check, and a valid token of the wrong role answers 403 before the endpoint's input check"
input_classes:
  - name: typical_valid_token_accepted_role
    input: "GET /me with Authorization: Bearer <customer token>"
    expected: "200 with that account's id, email, name and role"
  - name: empty_no_authorization_header
    input: "POST /events with a valid JSON body and no Authorization header"
    expected: "401 E_UNAUTHENTICATED with a body carrying the key error"
  - name: invalid_no_header_before_input_check
    input: "POST /events with no Authorization header and a body missing title and venue"
    expected: "401 E_UNAUTHENTICATED, not 400"
  - name: boundary_malformed_body_without_token
    input: "POST /events with no Authorization header and a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON with a body carrying the key error"
  - name: invalid_unissued_token
    input: "POST /events with Authorization: Bearer never-issued-value and a valid JSON body"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_malformed_bearer
    input: "POST /events with Authorization: Token abc123 and a valid JSON body"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_wrong_role
    input: "POST /events with Authorization: Bearer <customer token> and a valid JSON body"
    expected: "403 E_FORBIDDEN with a body carrying the key error"
  - name: invalid_role_before_input_check
    input: "POST /events with Authorization: Bearer <customer token> and a body whose tiers array is empty"
    expected: "403 E_FORBIDDEN, not 400"
negative_oracle:
  - input_class: empty_no_authorization_header
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 400 answer produced by a check of the body's fields"
  - input_class: invalid_role
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 201 event body"
  - input_class: boundary_malformed_body_without_token
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a 401 body for the missing token"
assertion_summary:
  - "each rejection carries a status in 400, 401, 403 and a JSON body with the key error"
  - "no 401 or 403 response body carries an event, an account or a token"
  - "the 401 for a missing token appears on every protected endpoint, not only on POST /events"
feasibility: feasible
```

### box-office:BEH-006

```yaml
id: box-office:BEH-006
template: Behavior
obligation: "GET /me answers 200 with the four fields of the account the token names and no password"
input_classes:
  - name: typical_organizer
    input: "GET /me with Authorization: Bearer <organizer token>"
    expected: "200 with a JSON object whose keys are exactly id, email, name and role, equal to the registration response of that account"
  - name: typical_customer
    input: "GET /me with Authorization: Bearer <customer token>"
    expected: "200 with that customer's id, email, name and role"
  - name: empty_no_authorization_header
    input: "GET /me with no Authorization header"
    expected: "401 E_UNAUTHENTICATED with a body carrying the key error"
  - name: invalid_token
    input: "GET /me with Authorization: Bearer never-issued-token"
    expected: "401 E_UNAUTHENTICATED with a body carrying the key error"
negative_oracle:
  - input_class: invalid_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 200 body carrying any account field"
assertion_summary:
  - "the returned id equals the id of the registration response of the token's account and differs from every other account's id"
  - "the body carries the keys id, email, name and role only"
  - "no response of this block contains the account's password string"
feasibility: feasible
```

### box-office:BEH-007

```yaml
id: box-office:BEH-007
template: Behavior
obligation: "a valid event creation answers 201 with status on_sale, the caller as organizerId, one tier record per submitted tier and available equal to quantity on every tier"
input_classes:
  - name: typical_one_tier
    input: "POST /events with Authorization: Bearer <organizer token> and body {\"title\": \"Night Jazz\", \"venue\": \"Blue Hall\", \"startsAt\": \"2027-03-01T18:00:00.000Z\", \"tiers\": [{\"name\": \"Balcony\", \"priceCents\": 1500, \"quantity\": 10}]}"
    expected: "201 with the event: status \"on_sale\", organizerId equal to the caller's id, startsAt echoed as the millisecond, Z-terminated form of the submitted instant, one tier holding a non-empty string id, name \"Balcony\", priceCents 1500, quantity 10 and available 10"
  - name: boundary_five_tiers
    input: "POST /events with five tiers named \"A\", \"B\", \"C\", \"D\", \"E\", each with priceCents 0, quantity 1 and a future startsAt"
    expected: "201 with five tier records, each available equal to its quantity"
  - name: boundary_quantity_10000
    input: "POST /events with one tier of quantity 10000 and priceCents 0"
    expected: "201 with that tier's quantity 10000 and available 10000"
  - name: boundary_starts_at_one_hour_ahead
    input: "POST /events with startsAt one hour after the request instant, expressed as a UTC instant with a Z"
    expected: "201 with status \"on_sale\" and startsAt echoed in the millisecond, Z-terminated form"
  - name: empty_zero_tiers
    input: "POST /events with tiers: []"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
  - name: invalid_six_tiers
    input: "POST /events with six distinctly named tiers"
    expected: "400 E_INVALID_INPUT"
negative_oracle:
  - input_class: empty_zero_tiers
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 event body, and a new entry in GET /events, whose total is unchanged"
  - input_class: invalid_six_tiers
    must_fail_with: "E_INVALID_INPUT"
    must_not: "an event carrying six tiers, observable as an unchanged total on GET /events"
assertion_summary:
  - "status of the 201 body is \"on_sale\" and organizerId equals the caller's id from GET /me"
  - "the tiers array holds one entry per submitted tier, in the submitted order, each id distinct"
  - "available equals quantity for every tier of the response"
  - "the response startsAt matches the form YYYY-MM-DDTHH:MM:SS.sssZ whatever form was submitted"
feasibility: feasible
```

### box-office:BEH-008

```yaml
id: box-office:BEH-008
template: Behavior
obligation: "each out-of-rule event field yields 400 E_INVALID_INPUT with the error body, or 400 E_MALFORMED_JSON for a body that is not valid JSON, and no event is created"
input_classes:
  - name: typical
    input: "POST /events with Authorization: Bearer <organizer token> and a valid one-tier body with priceCents 1500 and quantity 5"
    expected: "201 with status \"on_sale\""
  - name: boundary_title_1
    input: "POST /events with title of exactly 1 character, otherwise valid"
    expected: "201"
  - name: boundary_title_100
    input: "POST /events with title of exactly 100 characters, otherwise valid"
    expected: "201"
  - name: invalid_title_101
    input: "POST /events with title of exactly 101 characters, otherwise valid"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_venue_101
    input: "POST /events with venue of exactly 101 characters, otherwise valid"
    expected: "400 E_INVALID_INPUT"
  - name: boundary_quantity_10000
    input: "POST /events with one tier of quantity 10000"
    expected: "201 with available 10000"
  - name: invalid_quantity_10001
    input: "POST /events with one tier of quantity 10001"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_quantity_0
    input: "POST /events with one tier of quantity 0"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_quantity_not_integer
    input: "POST /events with one tier of quantity 2.5"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_repeated_tier_name
    input: "POST /events with two tiers both named \"Balcony\""
    expected: "400 E_INVALID_INPUT"
  - name: invalid_starts_at_in_past
    input: "POST /events with startsAt one hour before the request instant"
    expected: "400 E_INVALID_INPUT"
  - name: empty_zero_tiers
    input: "POST /events with tiers: []"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_six_tiers
    input: "POST /events with six tiers"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_price_fraction
    input: "POST /events with priceCents 15.5"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_price_negative
    input: "POST /events with priceCents -1"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_body_not_json
    input: "POST /events with a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON"
negative_oracle:
  - input_class: invalid_six_tiers
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 event body and a risen total in GET /events"
  - input_class: invalid_quantity_10001
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a tier holding quantity 10001 in any response"
  - input_class: invalid_body_not_json
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a 401 stem from the token check, which the served route and method already passed"
  - input_class: invalid_repeated_tier_name
    must_fail_with: "E_INVALID_INPUT"
    must_not: "an event whose tiers array holds two entries with the same name"
assertion_summary:
  - "every rejection carries a JSON body with the key error and no event fields"
  - "GET /events total is identical before and after each rejected request"
  - "the process answers a subsequent valid POST /events with 201"
feasibility: feasible
```

### box-office:BEH-009

```yaml
id: box-office:BEH-009
template: Behavior
obligation: "GET /events answers 200 with items holding only on_sale events ordered by startsAt then title, page 1, pageSize 10 and total counting every on_sale event"
input_classes:
  - name: typical_three_events
    input: "GET /events with no query, after three on_sale events were created with distinct startsAt values"
    expected: "200 with page 1, pageSize 10, total 3, and items of length 3 in ascending startsAt order"
  - name: empty_no_events
    input: "GET /events with no query on a process with no events"
    expected: "200 with items [], page 1, pageSize 10, total 0"
  - name: boundary_eleven_events
    input: "GET /events with no query, after eleven on_sale events were created"
    expected: "200 with total 11 and items of length 10"
  - name: boundary_shared_starts_at
    input: "GET /events after two on_sale events with the same startsAt and titles \"Alpha\" and \"Zulu\" were created"
    expected: "200 with items ordered by title for the shared instant, \"Alpha\" before \"Zulu\""
  - name: boundary_cancelled_present
    input: "GET /events after one on_sale and one cancelled event were created"
    expected: "200 with total 1 and items holding only the on_sale event"
  - name: invalid_page_not_integer
    input: "GET /events?page=abc"
    expected: "400 E_INVALID_QUERY with a body carrying the key error"
negative_oracle:
  - input_class: invalid_page_not_integer
    must_fail_with: "E_INVALID_QUERY"
    must_not: "a 200 page body"
assertion_summary:
  - "items is a JSON array of at most 10 event objects, each carrying id, title, venue, startsAt, status, organizerId and tiers, and every element's status is \"on_sale\""
  - "the order of ids in items equals the ascending order of their startsAt, ties broken by ascending title"
  - "total is a JSON integer counting every on_sale event, not the length of items"
  - "page is 1 and pageSize is 10 when the query carries neither"
feasibility: feasible
```

### box-office:BEH-010

```yaml
id: box-office:BEH-010
template: Behavior
obligation: "the query parameters narrow items inclusively while total counts every matching event, and an out-of-rule query answers 400 E_INVALID_QUERY"
input_classes:
  - name: typical_q_venue
    input: "GET /events?q=blue, where a tier-free event has title \"Night Jazz\" and venue \"Blue Hall\" and a second event has neither"
    expected: "200 with total 1 and items holding the event whose venue contains \"blue\""
  - name: typical_q_upper_case
    input: "GET /events?q=JAZZ against an event titled \"night jazz\""
    expected: "200 with total 1 and that event in items"
  - name: empty_no_query
    input: "GET /events with no query"
    expected: "200 with page 1, pageSize 10 and total equal to the number of on_sale events"
  - name: boundary_page_size_1
    input: "GET /events?pageSize=1 over two on_sale events"
    expected: "200 with pageSize 1, items of length 1 and total 2"
  - name: boundary_page_size_50
    input: "GET /events?pageSize=50"
    expected: "200 with pageSize 50 and items of length at most 50"
  - name: boundary_from_equals_starts_at
    input: "GET /events?from=<the exact startsAt of an event>"
    expected: "200 with that event in items, since the bounds are inclusive"
  - name: boundary_to_equals_starts_at
    input: "GET /events?to=<the exact startsAt of an event>"
    expected: "200 with that event in items"
  - name: boundary_page_2
    input: "GET /events?page=2&pageSize=1 over three on_sale events"
    expected: "200 with page 2, items of length 1 holding the second event in startsAt order, and total 3"
  - name: invalid_page_size_51
    input: "GET /events?pageSize=51"
    expected: "400 E_INVALID_QUERY with a body carrying the key error"
  - name: invalid_page_0
    input: "GET /events?page=0"
    expected: "400 E_INVALID_QUERY"
  - name: invalid_from_unreadable
    input: "GET /events?from=not-a-time"
    expected: "400 E_INVALID_QUERY"
negative_oracle:
  - input_class: invalid_page_size_51
    must_fail_with: "E_INVALID_QUERY"
    must_not: "a 200 page body with 51 items"
  - input_class: invalid_page_0
    must_fail_with: "E_INVALID_QUERY"
    must_not: "a 200 page body"
  - input_class: invalid_from_unreadable
    must_fail_with: "E_INVALID_QUERY"
    must_not: "a 200 page body computed as if the bound were absent"
assertion_summary:
  - "total counts every matching event of the whole result, not the page"
  - "pageSize of the response echoes the submitted pageSize and defaults to 10"
  - "items lengths never exceed pageSize"
  - "every items entry matches the filter applied, and no event outside the filter appears"
feasibility: feasible
```

### box-office:BEH-011

```yaml
id: box-office:BEH-011
template: Behavior
obligation: "a known event id answers 200 with the event, cancelled events included, and an unknown id answers 404 E_NOT_FOUND"
input_classes:
  - name: typical_on_sale
    input: "GET /events/<id of an on_sale event>"
    expected: "200 with the event's id, title, venue, startsAt, status \"on_sale\", organizerId and tiers"
  - name: typical_cancelled
    input: "GET /events/<id of an event already cancelled by its organizer>"
    expected: "200 with status \"cancelled\" and the same id, title and tiers"
  - name: empty_unknown_id
    input: "GET /events/no-such-event"
    expected: "404 E_NOT_FOUND with a body carrying the key error"
negative_oracle:
  - input_class: empty_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "an event body and a 200 status"
assertion_summary:
  - "the 200 body's id equals the requested id"
  - "a cancelled event answers 200 rather than 404, and carries status \"cancelled\""
  - "the 404 body is a JSON object with the key error and no event fields"
feasibility: feasible
```

### box-office:BEH-012

```yaml
id: box-office:BEH-012
template: Behavior
obligation: "cancelling an event answers 200 with status cancelled, moves every paid order of it to refunded and every held order to cancelled, and empties its waitlists"
input_classes:
  - name: typical_paid_and_held
    input: "POST /events/<id>/cancel by the event's organizer, where the event has one paid order and one held order"
    expected: "200 with status \"cancelled\"; GET /orders/<paid order id> reports \"refunded\"; GET /orders/<held order id> reports \"cancelled\"; GET /events/<id> reports every tier's available equal to quantity minus its tickets in held and paid orders"
  - name: empty_no_orders
    input: "POST /events/<id>/cancel for an event with no orders"
    expected: "200 with status \"cancelled\" and every tier's available still equal to its quantity"
  - name: boundary_waitlist_emptied
    input: "POST /events/<id>/cancel for an event holding one held order of customer C1 and two waitlist entries, one of them for the last remaining ticket of a tier"
    expected: "200 with status \"cancelled\"; the freed tickets appear as available on GET /events/<id> rather than held; GET /me/orders of the waiting customers holds no order created by the cancellation"
  - name: invalid_second_cancel
    input: "POST /events/<id>/cancel twice by the same organizer"
    expected: "the second call answers 409 E_EVENT_CANCELLED with a body carrying the key error"
  - name: invalid_other_organizer
    input: "POST /events/<id>/cancel with the token of another organizer"
    expected: "403 E_FORBIDDEN with a body carrying the key error"
negative_oracle:
  - input_class: invalid_second_cancel
    must_fail_with: "E_EVENT_CANCELLED"
    must_not: "a second 200 body and a status change"
  - input_class: invalid_other_organizer
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 200 body showing status \"cancelled\", since GET /events/<id> still reports \"on_sale\""
assertion_summary:
  - "the 200 body is the event with status \"cancelled\" and its id and tiers unchanged"
  - "no order of the event reports \"held\" or \"paid\" after the cancellation"
  - "every tier's available still equals quantity minus tickets in held orders minus tickets in paid orders after the cancellation"
  - "GET /events no longer lists the cancelled event while GET /events/<id> still answers it"
feasibility: feasible
```

### box-office:BEH-013

```yaml
id: box-office:BEH-013
template: Behavior
obligation: "cancel is limited to the event's creator and its on_sale state: 404 for an unknown id, 403 for another organizer or a customer, 409 for an already cancelled event"
input_classes:
  - name: typical_owning_organizer
    input: "POST /events/<id>/cancel with the token of the organizer who created it"
    expected: "200 with status \"cancelled\""
  - name: empty_unknown_id
    input: "POST /events/no-such-event/cancel with the token of an organizer"
    expected: "404 E_NOT_FOUND with a body carrying the key error"
  - name: invalid_other_organizer
    input: "POST /events/<id>/cancel with the token of another organizer"
    expected: "403 E_FORBIDDEN with a body carrying the key error"
  - name: invalid_customer
    input: "POST /events/<id>/cancel with a customer token"
    expected: "403 E_FORBIDDEN"
  - name: invalid_already_cancelled
    input: "POST /events/<id>/cancel with the creator's token on an event already cancelled"
    expected: "409 E_EVENT_CANCELLED"
  - name: invalid_other_organizer_unknown_id
    input: "POST /events/no-such-event/cancel with the token of another organizer"
    expected: "404 E_NOT_FOUND, decided before the ownership check"
negative_oracle:
  - input_class: invalid_other_organizer
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 200 body, since GET /events/<id> still reports \"on_sale\""
  - input_class: invalid_customer
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 401 status, since the customer token is valid"
  - input_class: invalid_already_cancelled
    must_fail_with: "E_EVENT_CANCELLED"
    must_not: "a second 200 body"
  - input_class: empty_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 or a 409 answer"
  - input_class: invalid_other_organizer_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 answer for the ownership failure"
assertion_summary:
  - "each rejection body is a JSON object with the key error and no event fields"
  - "an event untouched by a rejected cancel still reports status \"on_sale\" to its organizer"
feasibility: feasible
```

### box-office:BEH-014

```yaml
id: box-office:BEH-014
template: Behavior
obligation: "a held order answers 201 with unitPriceCents equal to the tier price, subtotalCents the sum, discountCents 0, totalCents equal to subtotalCents, paidAt null, expiresAt equal to createdAt plus HOLD_SECONDS, and the tier's available reduced by the ordered quantity"
input_classes:
  - name: typical_single_item
    input: "POST /orders with a customer token and body {\"eventId\": \"<on-sale event not yet started>\", \"items\": [{\"tierId\": \"<tier of priceCents 1500, quantity 10>\", \"quantity\": 2}]}"
    expected: "201 with status \"held\", items [{tierId, quantity 2, unitPriceCents 1500}], subtotalCents 3000, discountCode null, discountCents 0, totalCents 3000, paidAt null, createdAt and expiresAt in toISOString form, expiresAt minus createdAt equal to 600000 milliseconds; GET /events/<eventId> reports that tier's available 8"
  - name: typical_several_tiers
    input: "POST /orders with two items from two tiers of priceCents 1500 and 2500, quantities 1 and 3"
    expected: "201 with subtotalCents 9000 and both unitPriceCents echoed per item; both tiers' available reduced by their quantity"
  - name: boundary_hold_seconds_2
    input: "the process started with HOLD_SECONDS 2, then POST /orders for one ticket"
    expected: "201 with expiresAt minus createdAt equal to 2000 milliseconds"
  - name: empty_empty_items
    input: "POST /orders with body {\"eventId\": \"<known on-sale event>\", \"items\": []}"
    expected: "400 E_INVALID_INPUT with a body carrying the key error and no tier's available changed"
negative_oracle:
  - input_class: empty_empty_items
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 order body and a reduced available on GET /events/<eventId>"
assertion_summary:
  - "status of the 201 body is \"held\" and paidAt is null"
  - "unitPriceCents of each item equals that tier's priceCents read from GET /events/<eventId>"
  - "subtotalCents equals the sum of quantity times unitPriceCents, totalCents equals subtotalCents and discountCents is 0"
  - "expiresAt minus createdAt in milliseconds equals HOLD_SECONDS times 1000, with 600 when the variable is unset"
  - "available of each ordered tier fell by exactly the ordered quantity"
feasibility: feasible
```

### box-office:BEH-015

```yaml
id: box-office:BEH-015
template: Behavior
obligation: "empty items, a repeated tierId, a non-integer or below-1 quantity and a missing eventId or items each yield 400 E_INVALID_INPUT with no order and no change of any tier's available"
input_classes:
  - name: typical_quantity_1
    input: "POST /orders with one item of quantity 1 on a tier with available 5"
    expected: "201 with status \"held\" and that tier's available 4"
  - name: empty_empty_items
    input: "POST /orders with items: []"
    expected: "400 E_INVALID_INPUT"
  - name: empty_missing_items
    input: "POST /orders with body {\"eventId\": \"<known event>\"} and no items key"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_missing_event_id
    input: "POST /orders with body {\"items\": [{\"tierId\": \"<tier>\", \"quantity\": 1}]}"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_duplicate_tier
    input: "POST /orders with two items naming the same tierId, quantities 1 and 1"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_quantity_0
    input: "POST /orders with one item of quantity 0"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_quantity_fraction
    input: "POST /orders with one item of quantity 1.5"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_body_not_json
    input: "POST /orders with a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON"
negative_oracle:
  - input_class: invalid_duplicate_tier
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 order naming the tier twice, and any change of that tier's available on GET /events/<eventId>"
  - input_class: invalid_quantity_0
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a held order, since GET /me/orders stays unchanged"
  - input_class: invalid_body_not_json
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "an order created"
assertion_summary:
  - "every rejection body is a JSON object with the key error"
  - "GET /events/<eventId> reports the same available for every tier before and after each rejected request"
  - "GET /me/orders returns the same length before and after each rejected request"
feasibility: feasible
```

### box-office:BEH-016

```yaml
id: box-office:BEH-016
template: Behavior
obligation: "an unknown eventId answers 404 E_NOT_FOUND and a foreign tier 400 E_INVALID_TIER, both before the 409 checks for a cancelled, started or exhausted tier"
input_classes:
  - name: typical_quantity_equal_availability
    input: "POST /orders with quantity equal to the tier's available on an on-sale event that has not started"
    expected: "201 with status \"held\" and that tier's available 0"
  - name: empty_unknown_event
    input: "POST /orders with eventId \"no-such-event\" and any tierId"
    expected: "404 E_NOT_FOUND with a body carrying the key error"
  - name: invalid_foreign_tier
    input: "POST /orders with the id of event A and a tierId belonging to event B of the same organizer"
    expected: "400 E_INVALID_TIER with a body carrying the key error"
  - name: invalid_unknown_event_and_foreign_tier
    input: "POST /orders with eventId \"no-such-event\" and a tierId of a known event"
    expected: "404 E_NOT_FOUND, decided before the tier check"
  - name: invalid_cancelled_event
    input: "POST /orders for an event already cancelled"
    expected: "409 E_EVENT_NOT_ON_SALE with a body carrying the key error"
  - name: invalid_started_event
    input: "POST /orders for an event whose startsAt is one second in the past"
    expected: "409 E_EVENT_NOT_ON_SALE"
  - name: invalid_quantity_above_availability
    input: "POST /orders with quantity one above the tier's available"
    expected: "409 E_TICKETS_UNAVAILABLE with a body carrying the key error"
  - name: invalid_partially_available_order
    input: "POST /orders with two items, the first fitting its tier's available and the second one above its tier's available"
    expected: "409 E_TICKETS_UNAVAILABLE and neither tier's available changed"
negative_oracle:
  - input_class: invalid_cancelled_event
    must_fail_with: "E_EVENT_NOT_ON_SALE"
    must_not: "a held order and a reduced available"
  - input_class: invalid_quantity_above_availability
    must_fail_with: "E_TICKETS_UNAVAILABLE"
    must_not: "a 201 body and a changed available on any tier"
  - input_class: invalid_foreign_tier
    must_fail_with: "E_INVALID_TIER"
    must_not: "a 409 status, since the tier check comes first"
  - input_class: invalid_unknown_event_and_foreign_tier
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 400 answer for the tier check"
  - input_class: invalid_partially_available_order
    must_fail_with: "E_TICKETS_UNAVAILABLE"
    must_not: "a held order for the fitting tier only"
assertion_summary:
  - "each rejection body is a JSON object with the key error and no order fields"
  - "GET /events/<eventId> reports unchanged available for every tier after each rejected request"
  - "GET /me/orders of the caller is unchanged after each rejected request"
feasibility: feasible
```

### box-office:BEH-017

```yaml
id: box-office:BEH-017
template: Behavior
obligation: "the order that would take a customer past 6 tickets for the event answers 422 E_TICKET_LIMIT and an unusable discount code answers 422 E_DISCOUNT_UNUSABLE, neither holding anything"
input_classes:
  - name: typical_sixth_ticket
    input: "a customer holding 5 tickets of the event orders 1 more with no discount code"
    expected: "201 with status \"held\" and a total of 6 tickets across that customer's held and paid orders"
  - name: empty_empty_discount_code
    input: "POST /orders with discountCode \"\" on a tier with available tickets"
    expected: "422 E_DISCOUNT_UNUSABLE with a body carrying the key error"
  - name: invalid_seventh_ticket
    input: "a customer holding 5 tickets of the event orders 2 more with no discount code"
    expected: "422 E_TICKET_LIMIT with a body carrying the key error"
  - name: invalid_six_held_plus_one
    input: "a customer holding 6 tickets of the event orders 1 more"
    expected: "422 E_TICKET_LIMIT"
  - name: invalid_unknown_code
    input: "POST /orders with discountCode \"NEVERISSUED\" on an event holding no such code"
    expected: "422 E_DISCOUNT_UNUSABLE"
  - name: invalid_expired_code
    input: "POST /orders with a code whose expiresAt is one hour in the past"
    expected: "422 E_DISCOUNT_UNUSABLE"
  - name: invalid_used_up_code
    input: "POST /orders with a code of maxUses 1 already carried by one held order"
    expected: "422 E_DISCOUNT_UNUSABLE"
negative_oracle:
  - input_class: invalid_seventh_ticket
    must_fail_with: "E_TICKET_LIMIT"
    must_not: "a 201 order, since GET /me/orders holds 5 tickets' worth of items and the tier's available is unchanged"
  - input_class: invalid_unknown_code
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a held order carrying that code"
  - input_class: invalid_expired_code
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a discount applied in any 201 body"
  - input_class: invalid_used_up_code
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a held order carrying that code"
assertion_summary:
  - "each rejection body is a JSON object with the key error and no order fields"
  - "no rejection changes any tier's available on GET /events/<eventId>"
  - "the 201 body for the sixth ticket carries totalCents equal to its subtotalCents and discountCents 0 when no code is given"
feasibility: feasible
```

### box-office:BEH-018

```yaml
id: box-office:BEH-018
template: Behavior
obligation: "no response reports a held order past its expiresAt as held, its tickets count as free unless a hold created by waitlist serving took them, and an order in another status keeps it, a paid order past its former expiresAt included"
input_classes:
  - name: typical_still_held
    input: "GET /orders/<id of a held order whose expiresAt is one second in the future>"
    expected: "200 with status \"held\" and that order's items"
  - name: boundary_expired
    input: "the process started with HOLD_SECONDS 1, a held order is created, more than one second passes, then GET /orders/<id>, GET /me/orders and GET /events/<eventId>"
    expected: "GET /orders/<id> reports \"expired\"; the same order in GET /me/orders reports \"expired\"; GET /events/<eventId> reports the tier's available equal to quantity minus its tickets in held and paid orders, with the expired order counted in neither"
  - name: boundary_paid_past_expiry
    input: "a held order is paid, more than its HOLD_SECONDS passes, then GET /orders/<id> and GET /me/orders"
    expected: "the order reports \"paid\" in both responses and is never reported \"expired\""
  - name: empty_no_held_orders
    input: "GET /events/<eventId> of an event with no orders"
    expected: "200 with every tier's available equal to its quantity and no order of the event reporting \"held\""
  - name: invalid_pay_expired
    input: "more than HOLD_SECONDS after a hold was created, POST /orders/<id>/pay"
    expected: "409 E_ORDER_STATE with a body carrying the key error"
negative_oracle:
  - input_class: invalid_pay_expired
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status \"paid\" and a paidAt value"
assertion_summary:
  - "no response of this block carries the word held for an order whose expiresAt lies in the past"
  - "the tier's available grows by exactly the expired order's quantity when no waitlist entry fits"
  - "a paid order keeps status \"paid\" after its former expiresAt"
feasibility: feasible
```

### box-office:BEH-019

```yaml
id: box-office:BEH-019
template: Behavior
obligation: "paying a held order answers 200 with status paid and paidAt set, and paying an order in any other status or another customer's order fails"
input_classes:
  - name: typical_held_order
    input: "POST /orders/<id>/pay with the token of the order's customer, for a held order not yet expired"
    expected: "200 with status \"paid\", paidAt a non-null toISOString-form instant, and the same items, subtotalCents and totalCents as before"
  - name: empty_unknown_id
    input: "POST /orders/no-such-order/pay with a customer token"
    expected: "404 E_NOT_FOUND with a body carrying the key error"
  - name: invalid_already_paid
    input: "POST /orders/<id>/pay on an order already paid"
    expected: "409 E_ORDER_STATE"
  - name: invalid_expired
    input: "POST /orders/<id>/pay after the hold passed its expiresAt"
    expected: "409 E_ORDER_STATE"
  - name: invalid_cancelled
    input: "POST /orders/<id>/pay on a cancelled order"
    expected: "409 E_ORDER_STATE"
  - name: invalid_foreign_order
    input: "POST /orders/<id>/pay with the token of another customer"
    expected: "404 E_NOT_FOUND, not 403"
negative_oracle:
  - input_class: invalid_already_paid
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body and a changed paidAt"
  - input_class: invalid_expired
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status \"paid\""
  - input_class: invalid_cancelled
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status \"paid\""
  - input_class: invalid_foreign_order
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 status and a 200 order body"
  - input_class: empty_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 body"
assertion_summary:
  - "the 200 body's status is \"paid\" and paidAt is a JSON string in the millisecond, Z-terminated form"
  - "subtotalCents, discountCents and totalCents of the paid order equal those of the held order"
  - "the tier's available on GET /events/<eventId> is the same before paying and after paying"
feasibility: feasible
```

### box-office:BEH-020

```yaml
id: box-office:BEH-020
template: Behavior
obligation: "a held order becomes cancelled and a paid order becomes refunded only while its event starts more than 24 hours later, the tickets stop counting as held or paid, and any waitlist order created from them holds them again"
input_classes:
  - name: typical_refund_three_days
    input: "POST /orders/<id>/cancel with the order's customer token, for a paid order on an event starting 3 days later"
    expected: "200 with status \"refunded\"; GET /events/<eventId> reports the tier's available grown by the refunded quantity"
  - name: typical_held_cancel
    input: "POST /orders/<id>/cancel for a held order of the caller"
    expected: "200 with status \"cancelled\""
  - name: boundary_refund_25_hours
    input: "POST /orders/<id>/cancel for a paid order on an event starting 25 hours later"
    expected: "200 with status \"refunded\""
  - name: boundary_waitlist_fit
    input: "POST /orders/<id>/cancel for a held order of 2 tickets while another customer's waitlist entry for 2 tickets waits on that tier"
    expected: "200 with status \"cancelled\"; the tier's available on GET /events/<eventId> shows the freed tickets held again by a new held order, and the waiting customer's GET /me/orders holds a held order for 2 tickets of that tier"
  - name: invalid_inside_23_hours
    input: "POST /orders/<id>/cancel for a paid order on an event starting 23 hours later"
    expected: "409 E_ORDER_STATE with a body carrying the key error"
  - name: invalid_expired
    input: "POST /orders/<id>/cancel after the hold passed its expiresAt"
    expected: "409 E_ORDER_STATE"
  - name: invalid_foreign_order
    input: "POST /orders/<id>/cancel with the token of another customer"
    expected: "404 E_NOT_FOUND"
  - name: empty_unknown_id
    input: "POST /orders/no-such-order/cancel with a customer token"
    expected: "404 E_NOT_FOUND"
negative_oracle:
  - input_class: invalid_inside_23_hours
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status \"refunded\", since GET /orders/<id> still reports \"paid\""
  - input_class: invalid_expired
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status \"cancelled\""
  - input_class: invalid_foreign_order
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 or a 200 body"
  - input_class: empty_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 body"
assertion_summary:
  - "the 200 body of a held order carries status \"cancelled\" and of a paid order status \"refunded\""
  - "the tier's available on GET /events/<eventId> equals quantity minus tickets in held and paid orders after the call"
  - "the freed tickets appear as available only when no waitlist entry took them"
feasibility: feasible
```

### box-office:BEH-021

```yaml
id: box-office:BEH-021
template: Behavior
obligation: "GET /orders/:id answers 200 for the placing customer and for the event's organizer and 404 E_NOT_FOUND for every other caller and for an unknown id"
input_classes:
  - name: typical_customer
    input: "GET /orders/<id> with the token of the customer who placed it"
    expected: "200 with that order's id, eventId, customerId, status and items"
  - name: typical_organizer
    input: "GET /orders/<id> with the token of the organizer who created the order's event"
    expected: "200 with the same order body as the customer receives"
  - name: invalid_third_customer
    input: "GET /orders/<id> with the token of another customer"
    expected: "404 E_NOT_FOUND with a body carrying the key error"
  - name: invalid_other_organizer
    input: "GET /orders/<id> with the token of an organizer who created another event"
    expected: "404 E_NOT_FOUND"
  - name: empty_unknown_id
    input: "GET /orders/no-such-order with any valid token"
    expected: "404 E_NOT_FOUND"
negative_oracle:
  - input_class: invalid_third_customer
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 order body and a 403 status"
  - input_class: invalid_other_organizer
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 status"
  - input_class: empty_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 body"
assertion_summary:
  - "the 200 body of the customer and of the organizer carry the same order id and status"
  - "every rejection body is a JSON object with the key error and no order fields"
feasibility: feasible
```

### box-office:BEH-022

```yaml
id: box-office:BEH-022
template: Behavior
obligation: "GET /me/orders answers 200 with a JSON array of the caller's orders only, ordered by createdAt descending, each reflecting its current status"
input_classes:
  - name: typical_three_orders
    input: "GET /me/orders with a customer token after that customer placed three orders at distinct instants"
    expected: "200 with a JSON array of length 3 whose createdAt values descend, holding only that customer's order ids"
  - name: typical_one_order
    input: "GET /me/orders with a customer token after one order"
    expected: "200 with a JSON array of length 1"
  - name: empty_no_orders
    input: "GET /me/orders with the token of a customer who placed no order"
    expected: "200 with an empty JSON array []"
  - name: boundary_reflects_expiry
    input: "GET /me/orders after one of the caller's held orders passed its expiresAt with HOLD_SECONDS 1"
    expected: "200 with that order reporting status \"expired\""
  - name: invalid_organizer_role
    input: "GET /me/orders with an organizer token"
    expected: "403 E_FORBIDDEN with a body carrying the key error"
negative_oracle:
  - input_class: invalid_organizer_role
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 200 array body"
assertion_summary:
  - "the response body is a JSON array, not an object with an items key"
  - "every element's customerId equals the caller's id and no element belongs to another customer"
  - "the createdAt values of the array descend from the first element to the last"
feasibility: feasible
```

### box-office:BEH-023

```yaml
id: box-office:BEH-023
template: Behavior
obligation: "a created discount code is returned in upper case with uses 0, the supplied discount field keeps its value and absent optional fields are null"
input_classes:
  - name: typical_percent
    input: "POST /events/<id>/discounts with the organizer token and body {\"code\": \"earlybird\", \"percentOff\": 25}"
    expected: "201 with code \"EARLYBIRD\", percentOff 25, amountOffCents null, maxUses null, expiresAt null and uses 0"
  - name: typical_amount
    input: "POST /events/<id>/discounts with body {\"code\": \"FIVEOFF\", \"amountOffCents\": 500}"
    expected: "201 with code \"FIVEOFF\", amountOffCents 500, percentOff null and uses 0"
  - name: boundary_code_20
    input: "POST /events/<id>/discounts with a 20-character alphanumeric code and percentOff 10"
    expected: "201 with the upper-case form of that code"
  - name: empty_neither_discount
    input: "POST /events/<id>/discounts with body {\"code\": \"EARLYBIRD\"} and no discount field"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
  - name: invalid_repeat_case_different
    input: "after \"earlybird\" was created as \"EARLYBIRD\", POST /events/<id>/discounts with body {\"code\": \"EarlyBird\", \"percentOff\": 5}"
    expected: "409 E_CODE_TAKEN with a body carrying the key error"
  - name: invalid_not_owner
    input: "POST /events/<id>/discounts with the token of another organizer"
    expected: "403 E_FORBIDDEN"
negative_oracle:
  - input_class: invalid_repeat_case_different
    must_fail_with: "E_CODE_TAKEN"
    must_not: "a 201 body and a second code record for that event"
  - input_class: invalid_not_owner
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 201 body"
  - input_class: empty_neither_discount
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a stored code observable through a later checkout with that code answering 201"
assertion_summary:
  - "the code value of the 201 body is the submitted code upper-cased"
  - "the discount field that was submitted keeps its submitted integer value and the other discount field is null"
  - "maxUses and expiresAt are null when absent and echo the submitted value when present"
  - "uses is 0 in every 201 body"
feasibility: feasible
```

### box-office:BEH-024

```yaml
id: box-office:BEH-024
template: Behavior
obligation: "a code definition breaking any stated field rule answers 400 E_INVALID_INPUT and an unknown event id answers 404 E_NOT_FOUND, storing nothing"
input_classes:
  - name: typical_percent_50
    input: "POST /events/<id>/discounts with body {\"code\": \"HALF\", \"percentOff\": 50}"
    expected: "201 with percentOff 50 and uses 0"
  - name: boundary_percent_1
    input: "POST /events/<id>/discounts with percentOff 1"
    expected: "201"
  - name: boundary_percent_100
    input: "POST /events/<id>/discounts with percentOff 100"
    expected: "201"
  - name: invalid_percent_0
    input: "POST /events/<id>/discounts with percentOff 0"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_percent_101
    input: "POST /events/<id>/discounts with percentOff 101"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_both_discounts
    input: "POST /events/<id>/discounts with both percentOff 10 and amountOffCents 500"
    expected: "400 E_INVALID_INPUT"
  - name: empty_neither_discount
    input: "POST /events/<id>/discounts with neither percentOff nor amountOffCents"
    expected: "400 E_INVALID_INPUT"
  - name: boundary_code_3
    input: "POST /events/<id>/discounts with a 3-character alphanumeric code"
    expected: "201"
  - name: boundary_code_20
    input: "POST /events/<id>/discounts with a 20-character alphanumeric code"
    expected: "201"
  - name: invalid_code_2
    input: "POST /events/<id>/discounts with code \"ab\""
    expected: "400 E_INVALID_INPUT"
  - name: invalid_code_hyphen
    input: "POST /events/<id>/discounts with code \"ab-cd\""
    expected: "400 E_INVALID_INPUT"
  - name: invalid_amount_0
    input: "POST /events/<id>/discounts with amountOffCents 0"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_max_uses_0
    input: "POST /events/<id>/discounts with percentOff 10 and maxUses 0"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_unknown_event
    input: "POST /events/no-such-event/discounts with a valid code body"
    expected: "404 E_NOT_FOUND with a body carrying the key error"
  - name: invalid_body_not_json
    input: "POST /events/<id>/discounts with a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON"
negative_oracle:
  - input_class: invalid_both_discounts
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a stored code, observable through a later checkout carrying that code answering 201"
  - input_class: invalid_percent_101
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body"
  - input_class: invalid_code_hyphen
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body"
  - input_class: invalid_max_uses_0
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body"
  - input_class: invalid_unknown_event
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 400 answer for a field rule and a 201 body"
  - input_class: empty_neither_discount
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body"
  - input_class: invalid_body_not_json
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a 201 body"
assertion_summary:
  - "every rejection body is a JSON object with the key error and no code fields"
  - "a rejected definition leaves the code unusable at checkout, answering 422 E_DISCOUNT_UNUSABLE"
feasibility: feasible
```

### box-office:BEH-025

```yaml
id: box-office:BEH-025
template: Behavior
obligation: "checkout with a code matches case-insensitively, applies floor(subtotalCents times percentOff / 100) or min(amountOffCents, subtotalCents), echoes the stored upper-case code, decreases totalCents by discountCents and spends one use"
input_classes:
  - name: typical_lower_case_percent
    input: "POST /orders carrying discountCode \"earlybird\" for a tier of priceCents 1000, quantity 1, on an event holding code \"EARLYBIRD\" with percentOff 25"
    expected: "201 with subtotalCents 1000, discountCents 250, totalCents 750 and discountCode \"EARLYBIRD\""
  - name: boundary_percent_100
    input: "POST /orders with code \"FREE\" (percentOff 100) for a subtotal of 1000"
    expected: "201 with discountCents 1000 and totalCents 0"
  - name: boundary_percent_floor
    input: "POST /orders with a code of percentOff 33 for a subtotal of 1001"
    expected: "201 with discountCents 330, the floor of 330.33, and totalCents 671"
  - name: boundary_amount_above_subtotal
    input: "POST /orders with a code of amountOffCents 5000 for a subtotal of 1000"
    expected: "201 with discountCents 1000 and totalCents 0"
  - name: boundary_subtotal_0
    input: "POST /orders with a code of percentOff 25 for a tier of priceCents 0"
    expected: "201 with subtotalCents 0, discountCents 0 and totalCents 0"
  - name: empty_no_code
    input: "POST /orders without a discountCode field"
    expected: "201 with discountCode null, discountCents 0 and totalCents equal to subtotalCents"
  - name: invalid_unknown_code
    input: "POST /orders with a code the event does not hold"
    expected: "422 E_DISCOUNT_UNUSABLE with a body carrying the key error"
  - name: invalid_expired_code
    input: "POST /orders with a code whose expiresAt is one hour in the past"
    expected: "422 E_DISCOUNT_UNUSABLE"
  - name: invalid_used_up_code
    input: "POST /orders with a code of maxUses 1 already carried by a held order"
    expected: "422 E_DISCOUNT_UNUSABLE"
negative_oracle:
  - input_class: invalid_unknown_code
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a held order carrying that code"
  - input_class: invalid_expired_code
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a 201 body with a non-zero discountCents"
  - input_class: invalid_used_up_code
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a 201 body carrying that code"
assertion_summary:
  - "the discountCode of the 201 body is the stored upper-case code whatever case was submitted"
  - "discountCents equals the floor computation and totalCents equals subtotalCents minus discountCents"
  - "the use is spent observably: a code of maxUses 1 rejects a second checkout with 422 E_DISCOUNT_UNUSABLE while the first order is held"
  - "the case-different code is never reported as unknown"
feasibility: feasible
```

### box-office:BEH-026

```yaml
id: box-office:BEH-026
template: Behavior
obligation: "joining a waitlist answers 201 with position 1 or one above the tier's queue length only when the tier has fewer tickets available than asked, and a second entry for the same tier is 409"
input_classes:
  - name: typical_shortfall
    input: "POST /events/<id>/waitlist with a customer token, body {\"tierId\": \"<tier with available 0>\", \"quantity\": 2}"
    expected: "201 with id, eventId, tierId, quantity 2 and position 1; GET /events/<id> reports that tier's available still 0"
  - name: typical_second_entry
    input: "a second customer posts the same tier with quantity 1 while the first entry of quantity 2 waits"
    expected: "201 with position 2"
  - name: boundary_quantity_1
    input: "POST /events/<id>/waitlist with quantity 1 on a tier with available 0"
    expected: "201 with quantity 1"
  - name: boundary_quantity_6
    input: "POST /events/<id>/waitlist with quantity 6 on a tier with available 0"
    expected: "201 with quantity 6"
  - name: boundary_availability_one_below
    input: "POST /events/<id>/waitlist with quantity 2 on a tier with available 1"
    expected: "201 with position 1"
  - name: invalid_quantity_7
    input: "POST /events/<id>/waitlist with quantity 7 on a tier with available 0"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
  - name: invalid_quantity_0
    input: "POST /events/<id>/waitlist with quantity 0"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_tickets_available
    input: "POST /events/<id>/waitlist with quantity 2 on a tier with available 2"
    expected: "409 E_TICKETS_AVAILABLE with a body carrying the key error"
  - name: invalid_already_waiting
    input: "the same customer posts the same tier twice, both with quantity 1 on a tier with available 0"
    expected: "the second call answers 409 E_ALREADY_WAITING"
negative_oracle:
  - input_class: invalid_quantity_7
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 entry body"
  - input_class: invalid_tickets_available
    must_fail_with: "E_TICKETS_AVAILABLE"
    must_not: "a 201 entry body"
  - input_class: invalid_already_waiting
    must_fail_with: "E_ALREADY_WAITING"
    must_not: "a second entry body for that tier"
  - input_class: invalid_quantity_0
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 entry body"
assertion_summary:
  - "the 201 body carries id, eventId, tierId, quantity and position only"
  - "position is 1 with no queued entry and one above the tier's queue length otherwise"
  - "no accepted or rejected join changes a tier's available on GET /events/<id>"
feasibility: feasible
```

### box-office:BEH-027

```yaml
id: box-office:BEH-027
template: Behavior
obligation: "while the first waitlist entry's quantity fits the freed availability its customer receives one held order for that quantity with no discount code and an HOLD_SECONDS expiry, and while it does not fit no later entry is served and the queue keeps its order"
input_classes:
  - name: typical_first_fits
    input: "tier of quantity 2 with customer C1's waitlist entry of quantity 2 at position 1; a held order of another customer for 2 tickets expires with HOLD_SECONDS 1"
    expected: "GET /me/orders of C1 holds exactly one new order with status \"held\", items [{tierId, quantity 2, unitPriceCents equal to the tier's priceCents}], discountCode null, and expiresAt equal to its createdAt plus HOLD_SECONDS; GET /events/<id> reports that tier's available 0 again"
  - name: boundary_first_does_not_fit
    input: "tier of quantity 4; customer C_big holds 3 tickets and customer C_small holds 1; C1 waits for 3 tickets at position 1 and C2 waits for 1 ticket at position 2; C_small cancels its held order"
    expected: "GET /events/<id> reports available 1; GET /me/orders is empty of new orders for both C1 and C2, since C1 does not fit and C2 must not overtake it"
  - name: boundary_served_order_terms
    input: "the first entry of quantity 1 is served from one freed ticket on a tier of priceCents 1200"
    expected: "the served order carries items of unitPriceCents 1200, discountCode null, discountCents 0, totalCents 1200 and expiresAt minus createdAt equal to HOLD_SECONDS times 1000"
  - name: empty_no_freed_tickets
    input: "a tier whose waitlist holds one entry, with no order expiring, being cancelled or being refunded"
    expected: "no new order appears in any customer's GET /me/orders and the tier's available on GET /events/<id> is unchanged"
negative_oracle: []
assertion_summary:
  - "a served entry's customer ends with exactly one more held order than before, for the entry's quantity"
  - "when the first entry does not fit, no customer obtains a new order and the tier's available equals the freed amount"
  - "no order created by waitlist serving carries a discount code and every one carries a paidAt of null"
  - "the tier's available equals quantity minus tickets in held and paid orders after every serving round"
feasibility: feasible
```

### box-office:BEH-028

```yaml
id: box-office:BEH-028
template: Behavior
obligation: "a waitlist entry whose order would take its customer past 6 tickets for the event is removed without an order and serving continues with the next entry"
input_classes:
  - name: typical_five_held_plus_two
    input: "customer C1 holds 5 tickets of the event and waits for 2 tickets of a tier whose queue holds C1 at position 1 and customer C2 with quantity 1 at position 2; 2 tickets of that tier are freed"
    expected: "no order is created for C1, so GET /me/orders of C1 still holds 5 tickets' worth of items; C2 receives one held order for 1 ticket, observable in GET /me/orders of C2"
  - name: boundary_six_held_plus_one
    input: "customer C1 holds 6 tickets of the event and waits for 1 ticket; 2 tickets of that tier are freed"
    expected: "no order is created for C1 and the freed 2 tickets appear as available on GET /events/<id>"
  - name: boundary_served_exactly_six
    input: "customer C1 holds 4 tickets of the event and waits for 2 tickets; 2 tickets of that tier are freed"
    expected: "C1 receives one held order for 2 tickets and GET /me/orders of C1 then counts 6 tickets, none more"
  - name: empty_only_entry_removed
    input: "the over-limit entry is the only entry of the tier's queue and 2 tickets are freed"
    expected: "no order is created for anyone and GET /events/<id> reports the freed 2 tickets as available"
negative_oracle: []
assertion_summary:
  - "no customer's held and paid tickets for the event ever exceed 6 in the responses of this block"
  - "a dropped entry never yields an order, observable as an unchanged ticket count in GET /me/orders"
  - "the freed tickets either remain available or are held by the next entry's customer, never held by the over-limit entry"
feasibility: feasible
```

### box-office:BEH-029

```yaml
id: box-office:BEH-029
template: Behavior
obligation: "the report counts sold as tickets in paid orders only, held as tickets in held orders, grossCents and discountCents over paid orders, netCents as the sum of paid totalCents and refundedCents over refunded orders"
input_classes:
  - name: typical_paid_with_discount
    input: "GET /events/<id>/report with the organizer token, for an event with one paid order of subtotalCents 2000 and discountCents 400 and one held order of 1 ticket"
    expected: "200 with eventId, tiers rows carrying tierId, name, sold, held and available; the paid tier's sold 2 and held 1 on the respective tiers; grossCents 2000, discountCents 400, netCents 1600, refundedCents 0"
  - name: typical_held_not_sold
    input: "GET /events/<id>/report for an event with one held order of 3 tickets and no paid order"
    expected: "200 with the tier's sold 0, held 3, grossCents 0, discountCents 0, netCents 0 and refundedCents 0"
  - name: empty_no_orders
    input: "GET /events/<id>/report for an event with no orders"
    expected: "200 with one tiers row per tier carrying sold 0, held 0 and available equal to quantity, and all four sums 0"
  - name: boundary_refunded_order
    input: "GET /events/<id>/report for an event whose only order was paid and then refunded with totalCents 1600"
    expected: "200 with refundedCents 1600, grossCents 0, discountCents 0, netCents 0 and the tier's sold 0"
  - name: invalid_not_organizer
    input: "GET /events/<id>/report with a customer token"
    expected: "403 E_FORBIDDEN with a body carrying the key error"
  - name: invalid_other_organizer
    input: "GET /events/<id>/report with the token of another organizer"
    expected: "403 E_FORBIDDEN"
  - name: invalid_unknown_event
    input: "GET /events/no-such-event/report with an organizer token"
    expected: "404 E_NOT_FOUND"
negative_oracle:
  - input_class: invalid_not_organizer
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 200 report body"
  - input_class: invalid_unknown_event
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 report body"
assertion_summary:
  - "the report body carries eventId, tiers, grossCents, discountCents, refundedCents and netCents"
  - "every tier row carries tierId, name, sold, held and available, with sold equal to its tickets in paid orders and held equal to its tickets in held orders"
  - "netCents equals grossCents minus discountCents for paid orders"
  - "a refunded order contributes to refundedCents only, never to grossCents or netCents"
feasibility: feasible
```

### box-office:BEH-030

```yaml
id: box-office:BEH-030
template: Behavior
obligation: "one status answers a request that breaks several rules: 404 for an unknown route or unserved method, then 400 for a body that is not valid JSON, then token 401, role 403, input 400, named resource 404, ownership 403, state 409, limits 422"
input_classes:
  - name: typical_valid_request
    input: "GET /events with no token"
    expected: "200 with the page body"
  - name: empty_unknown_route_no_token
    input: "GET /nope with no Authorization header"
    expected: "404 E_NOT_FOUND with a body carrying the key error"
  - name: typical_unknown_route_with_token
    input: "GET /nope with Authorization: Bearer <organizer token>"
    expected: "404 E_NOT_FOUND"
  - name: invalid_unserved_method
    input: "PUT /events with Authorization: Bearer <organizer token> and a valid body"
    expected: "404 E_NOT_FOUND"
  - name: boundary_malformed_body_no_token
    input: "POST /events with no Authorization header and a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON"
  - name: invalid_token_before_input
    input: "POST /events with no Authorization header and tiers: []"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_wrong_role_invalid_fields
    input: "POST /events with a customer token and tiers: []"
    expected: "403 E_FORBIDDEN, not 400"
  - name: invalid_organizer_invalid_fields
    input: "POST /events with an organizer token and tiers: []"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_other_organizer_unknown_id
    input: "POST /events/no-such-event/cancel with another organizer's token"
    expected: "404 E_NOT_FOUND, not 403"
  - name: invalid_unknown_event_foreign_tier
    input: "POST /orders with eventId \"no-such-event\" and a tierId of a known event"
    expected: "404 E_NOT_FOUND, not 400 and not 409"
  - name: invalid_wrong_owner_cancelled_event
    input: "POST /events/<id>/cancel with another organizer's token on an event already cancelled"
    expected: "403 E_FORBIDDEN, since ownership decides before state"
negative_oracle:
  - input_class: empty_unknown_route_no_token
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 401 answer produced by the token check"
  - input_class: boundary_malformed_body_no_token
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a 401 answer for the missing token"
  - input_class: invalid_wrong_role_invalid_fields
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 400 answer for the body's fields"
  - input_class: invalid_other_organizer_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 answer for the ownership check"
  - input_class: invalid_unknown_event_foreign_tier
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 400 or 409 answer"
  - input_class: invalid_wrong_owner_cancelled_event
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 409 answer for the event's state"
  - input_class: invalid_token_before_input
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 400 answer for the body's fields"
  - input_class: invalid_unserved_method
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 405 status and a 401 answer"
assertion_summary:
  - "every request answers exactly one status and one JSON body"
  - "the answered status equals the first failing check's status of the stated order"
  - "each rejection body carries the key error"
feasibility: feasible
```

### box-office:BEH-031

```yaml
id: box-office:BEH-031
template: Behavior
obligation: "an unknown route or unserved method answers 404 and a body that is not valid JSON answers 400 E_MALFORMED_JSON on a served route, each with a JSON body carrying the key error, and the process answers the next request"
input_classes:
  - name: empty_unknown_route_no_token
    input: "GET /nope with no Authorization header"
    expected: "404 with a body {\"error\": \"<any message>\"}"
  - name: typical_unknown_route_with_token
    input: "GET /nope with Authorization: Bearer <organizer token>"
    expected: "404 with a body carrying the key error"
  - name: invalid_unserved_method
    input: "DELETE /users with a valid token"
    expected: "404 with a body carrying the key error"
  - name: invalid_json_served_route
    input: "POST /users with a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON with a body carrying the key error"
  - name: invalid_json_without_token
    input: "POST /events with no Authorization header and a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON"
  - name: boundary_two_failures_in_a_row
    input: "GET /nope, then POST /users with a body that is not valid JSON, then GET /events"
    expected: "404, then 400, then 200 with the page body"
  - name: invalid_422_failure_body
    input: "POST /orders that would take the customer to 7 tickets of the event"
    expected: "422 E_TICKET_LIMIT with a body carrying the key error"
negative_oracle:
  - input_class: empty_unknown_route_no_token
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 401 answer for the missing token"
  - input_class: invalid_json_without_token
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a 401 answer for the missing token"
  - input_class: invalid_422_failure_body
    must_fail_with: "E_TICKET_LIMIT"
    must_not: "a status outside 400, 401, 403, 404, 409, 422"
assertion_summary:
  - "every failure body is a JSON object whose key error holds a string"
  - "no failure body is empty or free text"
  - "every failure status lies in 400, 401, 403, 404, 409, 422"
  - "the process serves the request that follows a failure"
feasibility: feasible
```

### box-office:SCN-001

```yaml
id: box-office:SCN-001
template: Scenario
obligation: "expiry of the last-holding order frees its tickets and the queue serves exactly one entry, which leaves the list holding a new order at the tier's price with no discount code"
input_classes:
  - name: typical_expiry_serves_queue
    input: "process started with HOLD_SECONDS 2; an event with one tier of quantity 2; customer C1 orders 2 tickets; customer C2 joins the waitlist for 2 tickets; more than 2 seconds pass; GET /orders/<C1 order>, GET /events/<id> and GET /me/orders with C2's token"
    expected: "C1's order reports \"expired\"; GET /events/<id> reports the tier's available 0, because a held order of 2 tickets for C2 took the freed tickets; GET /me/orders with C2's token holds exactly one order with status \"held\", items [{tierId, quantity 2, unitPriceCents equal to the tier's priceCents}] and discountCode null"
  - name: boundary_two_entries_first_fits
    input: "tier of quantity 2; customer C1 waits for 2 tickets at position 1 and customer C2 waits for 1 ticket at position 2; the held order of 2 tickets expires"
    expected: "C1 holds a new order for 2 tickets, C2 holds none, and GET /events/<id> reports available 0"
  - name: empty_no_queue
    input: "tier of quantity 2 held entirely by one order, with no waitlist entry on the tier; the hold expires"
    expected: "GET /orders/<id> reports \"expired\", GET /events/<id> reports available 2, and no customer's GET /me/orders gains an order"
  - name: boundary_hold_seconds_2
    input: "the same as typical_expiry_serves_queue with HOLD_SECONDS 2, reading the order once more than 2 seconds after its createdAt"
    expected: "the order never reports \"held\" in any read after its expiresAt, and the served order's expiresAt equals its createdAt plus 2 seconds"
observable_sequence:
  - "start the process with HOLD_SECONDS 2 and create an event with one tier of quantity 2 → GET /events/<id> reports available 2"
  - "customer C1 orders 2 tickets of that tier → 201 held and GET /events/<id> reports available 0"
  - "customer C2 posts the same tier with quantity 2 → 201 with position 1"
  - "more than 2 seconds pass, then GET /orders/<C1 order> → status expired"
  - "GET /me/orders with C2's token → exactly one held order for 2 tickets of that tier with discountCode null"
  - "GET /events/<id> → available 0, the freed tickets being held by C2's new order"
negative_oracle: []
assertion_summary:
  - "no read after the expiry reports the first order as held"
  - "the queue serves exactly one entry: the entry's customer holds one new order and no later entry's customer holds any"
  - "the new order's unitPriceCents equals the tier's priceCents, its discountCode is null and its expiresAt equals its createdAt plus HOLD_SECONDS"
  - "the tier's available ends at quantity minus its tickets in held and paid orders"
feasibility: feasible
```

### box-office:SCN-002

```yaml
id: box-office:SCN-002
template: Scenario
obligation: "paying a held order then cancelling it reverses the tickets, the discount use and the report figures, and a second cancel answers 409"
input_classes:
  - name: typical_three_days
    input: "a held order of 1 ticket with a percentOff 10 code on an event starting 3 days later; POST /orders/<id>/pay, then POST /orders/<id>/cancel"
    expected: "pay answers 200 with status \"paid\" and a non-null paidAt; cancel answers 200 with status \"refunded\"; GET /events/<id> reports the tier's available back to its quantity; GET /events/<id>/report reports refundedCents equal to the order's totalCents, grossCents 0 and netCents 0"
  - name: boundary_25_hours
    input: "the same with an event starting 25 hours later"
    expected: "cancel answers 200 with status \"refunded\""
  - name: invalid_23_hours
    input: "the same with an event starting 23 hours later"
    expected: "cancel answers 409 E_ORDER_STATE with a body carrying the key error"
  - name: invalid_second_cancel
    input: "POST /orders/<id>/cancel twice after the refund"
    expected: "the second call answers 409 E_ORDER_STATE"
observable_sequence:
  - "create an event starting 3 days later with one tier and a code of percentOff 10 → 201 with code upper-cased"
  - "POST /orders with that code → 201 held with discountCents equal to a tenth of subtotalCents"
  - "POST /orders/<id>/pay → 200 with status paid and paidAt set"
  - "POST /orders/<id>/cancel → 200 with status refunded"
  - "GET /events/<id> → available equal to the tier's quantity"
  - "GET /events/<id>/report → refundedCents equal to the order's totalCents, grossCents 0, netCents 0"
  - "a code of maxUses 1 in the same state accepts a new checkout with 201, showing the use returned"
negative_oracle:
  - input_class: invalid_23_hours
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status refunded, since GET /orders/<id> still reports paid"
  - input_class: invalid_second_cancel
    must_fail_with: "E_ORDER_STATE"
    must_not: "a second 200 body"
assertion_summary:
  - "the pay response carries status \"paid\" and a paidAt in the millisecond, Z-terminated form"
  - "the cancel response carries status \"refunded\" and no paidAt reset to null"
  - "the report's refundedCents equals the order's totalCents and its grossCents excludes the refunded order"
  - "the tier's available returns to its quantity, so the refunded tickets count in neither held nor paid"
feasibility: feasible
```

### box-office:SCN-003

```yaml
id: box-office:SCN-003
template: Scenario
obligation: "cancelling an event leaves no order of it held or paid, drops every waitlist entry and sums the refunded orders in refundedCents"
input_classes:
  - name: typical_paid_held_waitlist
    input: "an on_sale event with 1 paid order, 1 held order and 2 waitlist entries; POST /events/<id>/cancel by its organizer, then GET /events, GET /events/<id>, GET /orders/<id> of both orders and GET /events/<id>/report"
    expected: "cancel answers 200 with status \"cancelled\"; GET /events excludes the event while GET /events/<id> answers it with status \"cancelled\"; the paid order reads \"refunded\" and the held order \"cancelled\"; the report reports refundedCents equal to the refunded order's totalCents"
  - name: boundary_only_held
    input: "an event with held orders only"
    expected: "every order reports \"cancelled\" and every tier's available equals its quantity"
  - name: empty_no_orders
    input: "an event with no orders and no waitlist entry"
    expected: "200 with status \"cancelled\" and a report of all zeros"
  - name: invalid_second_cancel
    input: "POST /events/<id>/cancel twice"
    expected: "the second call answers 409 E_EVENT_CANCELLED with a body carrying the key error"
observable_sequence:
  - "create an event with one tier and create 1 paid order, 1 held order and 2 waitlist entries on it"
  - "POST /events/<id>/cancel by the organizer → 200 with status cancelled"
  - "GET /events → the event's id is absent from items"
  - "GET /events/<id> → 200 with status cancelled"
  - "GET /orders/<paid order id> → status refunded; GET /orders/<held order id> → status cancelled"
  - "GET /events/<id>/report → refundedCents equals the refunded order's totalCents and the tiers rows hold held 0"
  - "GET /me/orders of each waiting customer → no order created by the cancellation"
negative_oracle:
  - input_class: invalid_second_cancel
    must_fail_with: "E_EVENT_CANCELLED"
    must_not: "a second 200 body"
assertion_summary:
  - "no order of the event reports held or paid after the cancellation"
  - "every waitlist entry of the event is gone: no customer's GET /me/orders gains an order from the cancellation"
  - "the report's refundedCents equals the sum of the refunded orders' totalCents"
  - "GET /events excludes the event while GET /events/<id> still answers it"
feasibility: feasible
```

### box-office:SCN-004

```yaml
id: box-office:SCN-004
template: Scenario
obligation: "discount uses count held and paid orders, an order that ends gives its use back, and a checkout with a used-up code answers 422 E_DISCOUNT_UNUSABLE"
input_classes:
  - name: typical_max_uses_1
    input: "process started with HOLD_SECONDS 2; event with one tier and code \"ONCE\" of maxUses 1 and percentOff 10; a checkout with that code, then a second checkout with the same code, then more than 2 seconds pass, then a third checkout with the code lower-cased"
    expected: "first checkout 201 with discountCode \"ONCE\"; second checkout 422 E_DISCOUNT_UNUSABLE; the first order reports \"expired\" after the wait; third checkout 201 with discountCode \"ONCE\""
  - name: boundary_max_uses_2
    input: "a code of maxUses 2 checked out twice, then once more while both orders are held"
    expected: "the first two checkouts answer 201 and the third answers 422 E_DISCOUNT_UNUSABLE"
  - name: boundary_cancelled_instead_of_expired
    input: "a code of maxUses 1 whose single held order is cancelled instead of expired, then a new checkout with that code"
    expected: "the cancel answers 200 with status \"cancelled\" and the new checkout answers 201"
  - name: empty_no_discount_code
    input: "a checkout without any discountCode on the same event"
    expected: "201 with discountCode null, discountCents 0 and totalCents equal to subtotalCents"
observable_sequence:
  - "create an event with one tier and a code \"ONCE\" of maxUses 1 and percentOff 10 → 201 with uses 0"
  - "checkout carrying discountCode \"ONCE\" → 201 with discountCode \"ONCE\" and a non-zero discountCents"
  - "a second checkout carrying \"ONCE\" while the first order is held → 422 E_DISCOUNT_UNUSABLE"
  - "wait past the first order's expiresAt and read GET /orders/<id> → status expired"
  - "a third checkout carrying \"once\" → 201 with discountCode \"ONCE\""
negative_oracle:
  - input_class: typical_max_uses_1
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a 201 body for the second checkout"
assertion_summary:
  - "the second checkout is rejected while the first order is held, so uses reached maxUses"
  - "after the first order expired or was cancelled, the same code is accepted again with 201"
  - "every 201 body carrying the code reports it in upper case"
feasibility: feasible
```

### box-office:CTR-001

```yaml
id: box-office:CTR-001
template: Contract
obligation: "POST /users, a public route, answers 201 with id, email, name and role, 400 E_MALFORMED_JSON for a body that is not valid JSON, 400 E_INVALID_INPUT for a non-object body or an out-of-rule field, and 409 E_EMAIL_TAKEN for an email already registered in another case"
input_classes:
  - name: typical_organizer
    input: "POST /users with no Authorization header and body {\"email\": \"ada@example.com\", \"password\": \"12345678\", \"name\": \"Ada\", \"role\": \"organizer\"}"
    expected: "201 with a JSON object holding id, email, name and role"
  - name: typical_customer
    input: "POST /users with role \"customer\", otherwise valid"
    expected: "201 with role \"customer\""
  - name: empty_body_not_object
    input: "POST /users with body []"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
  - name: invalid_field_out_of_rule
    input: "POST /users with password of 7 characters, otherwise valid"
    expected: "400 E_INVALID_INPUT"
  - name: boundary_duplicate_email_other_case
    input: "POST /users with email \"ADA@EXAMPLE.COM\" after \"ada@example.com\" was registered"
    expected: "409 E_EMAIL_TAKEN"
negative_oracle:
  - input_class: empty_body_not_object
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body and 401, since the route is public and needs no token"
  - input_class: invalid_field_out_of_rule
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body"
assertion_summary:
  - "no 201 body carries a password key or the submitted password value"
  - "the response keys are exactly id, email, name and role"
  - "the route answers without any Authorization header"
feasibility: feasible
```

### box-office:CTR-002

```yaml
id: box-office:CTR-002
template: Contract
obligation: "POST /sessions answers 200 with a token for a matching pair, 400 E_MALFORMED_JSON for a body that is not valid JSON, 400 E_INVALID_INPUT for a non-object body or a missing field, and 401 E_UNAUTHENTICATED when the pair matches no account"
input_classes:
  - name: typical_correct_pair
    input: "POST /sessions with {\"email\": \"ada@example.com\", \"password\": \"correct-horse\"}"
    expected: "200 with a JSON object whose token is a non-empty string"
  - name: empty_missing_password
    input: "POST /sessions with {\"email\": \"ada@example.com\"}"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
  - name: invalid_wrong_password
    input: "POST /sessions with {\"email\": \"ada@example.com\", \"password\": \"wrong-horse\"}"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_unregistered_email
    input: "POST /sessions with {\"email\": \"nobody@example.com\", \"password\": \"correct-horse\"}"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_body_not_json
    input: "POST /sessions with a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON"
negative_oracle:
  - input_class: invalid_wrong_password
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a key named token in the response body"
  - input_class: empty_missing_password
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 401 answer and a token"
  - input_class: invalid_body_not_json
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a 401 answer"
assertion_summary:
  - "the 200 body carries the key token holding a non-empty string and nothing revealing the password"
  - "no 401 or 400 body carries a token key"
feasibility: feasible
```

### box-office:CTR-003

```yaml
id: box-office:CTR-003
template: Contract
obligation: "GET /me answers 200 with the four fields of the token's account and 401 E_UNAUTHENTICATED when the header is absent or its token is not valid"
input_classes:
  - name: typical_organizer
    input: "GET /me with Authorization: Bearer <organizer token>"
    expected: "200 with id, email, name and role"
  - name: typical_customer
    input: "GET /me with Authorization: Bearer <customer token>"
    expected: "200 with that customer's four fields"
  - name: empty_absent_header
    input: "GET /me with no Authorization header"
    expected: "401 E_UNAUTHENTICATED with a body carrying the key error"
  - name: invalid_unissued_token
    input: "GET /me with Authorization: Bearer never-issued-value"
    expected: "401 E_UNAUTHENTICATED"
negative_oracle:
  - input_class: empty_absent_header
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 200 account body"
  - input_class: invalid_unissued_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 403 answer and a 200 account body"
assertion_summary:
  - "the 200 body carries id, email, name, role and no password"
  - "each 401 body carries the key error and no account field"
feasibility: feasible
```

### box-office:CTR-004

```yaml
id: box-office:CTR-004
template: Contract
obligation: "POST /events answers 201 with the event on_sale for a valid body, 401 for a missing or invalid token, 403 for a non-organizer, 400 E_MALFORMED_JSON for a body that is not valid JSON and 400 E_INVALID_INPUT for every stated field rule"
input_classes:
  - name: typical_one_tier
    input: "POST /events with an organizer token and one tier of priceCents 1500, quantity 5 and a startsAt one day ahead"
    expected: "201 with status \"on_sale\" and that tier's available 5"
  - name: boundary_five_tiers
    input: "POST /events with five distinctly named tiers"
    expected: "201 with five tier records"
  - name: boundary_quantity_10000
    input: "POST /events with one tier of quantity 10000"
    expected: "201 with available 10000"
  - name: empty_zero_tiers
    input: "POST /events with tiers: []"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_starts_at_past
    input: "POST /events with startsAt one hour before the request instant"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_starts_at_unreadable
    input: "POST /events with startsAt \"next tuesday-ish\""
    expected: "400 E_INVALID_INPUT"
  - name: invalid_title_101
    input: "POST /events with title of 101 characters"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_no_token
    input: "POST /events with no Authorization header and a valid body"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_customer_role
    input: "POST /events with a customer token and a valid body"
    expected: "403 E_FORBIDDEN"
  - name: invalid_body_not_json
    input: "POST /events with a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON"
negative_oracle:
  - input_class: empty_zero_tiers
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 event body"
  - input_class: invalid_starts_at_past
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body whose status is on_sale"
  - input_class: invalid_customer_role
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 201 body"
  - input_class: invalid_no_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 403 or a 201 answer"
  - input_class: invalid_body_not_json
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a 401 answer"
assertion_summary:
  - "every tier of a 201 body carries id, name, priceCents, quantity and available"
  - "available equals quantity on every tier of a 201 body"
  - "the event's status in every 201 body is \"on_sale\""
feasibility: feasible
```

### box-office:CTR-005

```yaml
id: box-office:CTR-005
template: Contract
obligation: "GET /events answers 200 with the four page fields for a valid query and 400 E_INVALID_QUERY when from or to is unreadable, page is not an integer of at least 1 or pageSize is outside 1-50"
input_classes:
  - name: typical_default_page
    input: "GET /events with no query over two on_sale events"
    expected: "200 with items of length 2, page 1, pageSize 10 and total 2"
  - name: empty_no_events
    input: "GET /events with no query on a process with no events"
    expected: "200 with items [], page 1, pageSize 10, total 0"
  - name: boundary_page_size_50
    input: "GET /events?pageSize=50"
    expected: "200 with pageSize 50"
  - name: invalid_page_size_51
    input: "GET /events?pageSize=51"
    expected: "400 E_INVALID_QUERY with a body carrying the key error"
  - name: invalid_page_0
    input: "GET /events?page=0"
    expected: "400 E_INVALID_QUERY"
  - name: boundary_q_venue_only
    input: "GET /events?q=HALL against an event titled \"Night Jazz\" with venue \"Blue Hall\""
    expected: "200 with total 1 holding that event"
  - name: invalid_from_unreadable
    input: "GET /events?from=midnightish"
    expected: "400 E_INVALID_QUERY"
negative_oracle:
  - input_class: invalid_page_size_51
    must_fail_with: "E_INVALID_QUERY"
    must_not: "a 200 page body"
  - input_class: invalid_page_0
    must_fail_with: "E_INVALID_QUERY"
    must_not: "a 200 page body whose page is 1"
  - input_class: invalid_from_unreadable
    must_fail_with: "E_INVALID_QUERY"
    must_not: "a 200 page body"
assertion_summary:
  - "the body carries exactly items, page, pageSize and total"
  - "total counts every matching on_sale event rather than the page"
  - "items holds on_sale events only, ordered by startsAt then title"
feasibility: feasible
```

### box-office:CTR-006

```yaml
id: box-office:CTR-006
template: Contract
obligation: "GET /events/:id answers 200 with the event, cancelled ones included, and 404 E_NOT_FOUND when no event carries the id"
input_classes:
  - name: typical_on_sale
    input: "GET /events/<id of an on_sale event>"
    expected: "200 with id, title, venue, startsAt, status, organizerId and tiers"
  - name: typical_cancelled
    input: "GET /events/<id of a cancelled event>"
    expected: "200 with status \"cancelled\""
  - name: empty_unknown_id
    input: "GET /events/no-such-event"
    expected: "404 E_NOT_FOUND with a body carrying the key error"
negative_oracle:
  - input_class: empty_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 event body"
assertion_summary:
  - "the 200 body's id equals the requested id and its keys are id, title, venue, startsAt, status, organizerId and tiers"
  - "each tier of the 200 body carries id, name, priceCents, quantity and available"
  - "the 404 body carries the key error and no event field"
feasibility: feasible
```

### box-office:CTR-007

```yaml
id: box-office:CTR-007
template: Contract
obligation: "POST /events/:id/cancel answers 200 with the event cancelled for its creator, 401 without a valid token, 403 for a non-organizer or another organizer, 404 for an unknown id and 409 E_EVENT_CANCELLED for an event already cancelled"
input_classes:
  - name: typical_creating_organizer
    input: "POST /events/<id>/cancel with the creating organizer's token"
    expected: "200 with status \"cancelled\" and the event's id and tiers unchanged"
  - name: empty_unknown_id
    input: "POST /events/no-such-event/cancel with an organizer token"
    expected: "404 E_NOT_FOUND"
  - name: invalid_other_organizer
    input: "POST /events/<id>/cancel with another organizer's token"
    expected: "403 E_FORBIDDEN"
  - name: invalid_customer
    input: "POST /events/<id>/cancel with a customer token"
    expected: "403 E_FORBIDDEN"
  - name: invalid_cancelled_event
    input: "POST /events/<id>/cancel on an event already cancelled, with its creator's token"
    expected: "409 E_EVENT_CANCELLED"
  - name: invalid_no_token
    input: "POST /events/<id>/cancel with no Authorization header"
    expected: "401 E_UNAUTHENTICATED"
negative_oracle:
  - input_class: invalid_other_organizer
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 200 body, since GET /events/<id> still reports \"on_sale\""
  - input_class: invalid_customer
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 401 answer"
  - input_class: invalid_cancelled_event
    must_fail_with: "E_EVENT_CANCELLED"
    must_not: "a second 200 body"
  - input_class: empty_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 answer"
  - input_class: invalid_no_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 200 body"
assertion_summary:
  - "the 200 body is the event with status \"cancelled\" and unchanged id and tiers"
  - "every rejection body is a JSON object with the key error"
feasibility: feasible
```

### box-office:CTR-008

```yaml
id: box-office:CTR-008
template: Contract
obligation: "POST /orders creates a held order only when every stated rule passes, and answers 401, 403, 400 E_MALFORMED_JSON, 400 E_INVALID_INPUT, 404 E_NOT_FOUND, 400 E_INVALID_TIER, 409 E_EVENT_NOT_ON_SALE, 409 E_TICKETS_UNAVAILABLE, 422 E_TICKET_LIMIT or 422 E_DISCOUNT_UNUSABLE otherwise, leaving no state change"
input_classes:
  - name: typical_one_item
    input: "POST /orders with a customer token and one item of quantity 1 on an on-sale event with available tickets"
    expected: "201 with status \"held\" and expiresAt equal to createdAt plus HOLD_SECONDS"
  - name: boundary_six_tickets_one_order
    input: "POST /orders with one item of quantity 6"
    expected: "201 with status \"held\" and items of quantity 6"
  - name: boundary_quantity_exhausted
    input: "POST /orders for the tier's whole available quantity"
    expected: "201 with status \"held\" and that tier's available 0"
  - name: empty_items_empty
    input: "POST /orders with items: []"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_seventh_ticket
    input: "POST /orders for 2 more tickets by a customer already holding 5 for the event"
    expected: "422 E_TICKET_LIMIT"
  - name: invalid_unknown_event
    input: "POST /orders with eventId \"no-such-event\""
    expected: "404 E_NOT_FOUND"
  - name: invalid_foreign_tier
    input: "POST /orders naming a tierId of another event"
    expected: "400 E_INVALID_TIER"
  - name: invalid_cancelled_event
    input: "POST /orders for a cancelled event"
    expected: "409 E_EVENT_NOT_ON_SALE"
  - name: invalid_quantity_0
    input: "POST /orders with one item of quantity 0"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_unusable_code
    input: "POST /orders with a discountCode the event does not hold"
    expected: "422 E_DISCOUNT_UNUSABLE"
  - name: invalid_no_token
    input: "POST /orders with no Authorization header"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_organizer_role
    input: "POST /orders with an organizer token"
    expected: "403 E_FORBIDDEN"
negative_oracle:
  - input_class: invalid_seventh_ticket
    must_fail_with: "E_TICKET_LIMIT"
    must_not: "a 201 order body and a changed available"
  - input_class: invalid_unknown_event
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 400 or 409 answer"
  - input_class: invalid_foreign_tier
    must_fail_with: "E_INVALID_TIER"
    must_not: "a 201 order body and a 409 answer"
  - input_class: invalid_cancelled_event
    must_fail_with: "E_EVENT_NOT_ON_SALE"
    must_not: "a 201 body"
  - input_class: invalid_unusable_code
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a 201 body carrying that code"
  - input_class: invalid_quantity_0
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body"
  - input_class: invalid_no_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 403 answer"
  - input_class: invalid_organizer_role
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 201 body"
assertion_summary:
  - "every 201 body carries status \"held\", paidAt null and expiresAt equal to createdAt plus HOLD_SECONDS seconds"
  - "every rejection leaves every tier's available unchanged on GET /events/<eventId> and GET /me/orders unchanged"
  - "no 201 body carries a partial order when one item of the request could not be satisfied"
feasibility: feasible
```

### box-office:CTR-009

```yaml
id: box-office:CTR-009
template: Contract
obligation: "POST /orders/:id/pay answers 200 with the order paid and paidAt set for a held order of the caller, 401 without a valid token, 403 for a non-customer, 404 for an unknown or foreign order and 409 E_ORDER_STATE for any other status"
input_classes:
  - name: typical_held
    input: "POST /orders/<id>/pay with the order's customer token on a held order"
    expected: "200 with status \"paid\" and paidAt a non-null toISOString-form instant"
  - name: empty_unknown_order
    input: "POST /orders/no-such-order/pay with a customer token"
    expected: "404 E_NOT_FOUND"
  - name: invalid_expired_order
    input: "POST /orders/<id>/pay after the hold's expiresAt"
    expected: "409 E_ORDER_STATE"
  - name: invalid_paid_order
    input: "POST /orders/<id>/pay on an order already paid"
    expected: "409 E_ORDER_STATE"
  - name: invalid_foreign_order
    input: "POST /orders/<id>/pay with another customer's token"
    expected: "404 E_NOT_FOUND"
  - name: invalid_organizer_role
    input: "POST /orders/<id>/pay with an organizer token"
    expected: "403 E_FORBIDDEN"
  - name: invalid_no_token
    input: "POST /orders/<id>/pay with no Authorization header"
    expected: "401 E_UNAUTHENTICATED"
negative_oracle:
  - input_class: invalid_expired_order
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status paid"
  - input_class: invalid_paid_order
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with a new paidAt"
  - input_class: invalid_foreign_order
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 or a 200 answer"
  - input_class: invalid_organizer_role
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 404 answer"
  - input_class: invalid_no_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 200 body"
assertion_summary:
  - "the 200 body carries status \"paid\" and paidAt in the millisecond, Z-terminated form"
  - "the items, subtotalCents and totalCents of the paid order equal those of the held order"
  - "the tier's available is unchanged by the payment"
feasibility: feasible
```

### box-office:CTR-010

```yaml
id: box-office:CTR-010
template: Contract
obligation: "POST /orders/:id/cancel answers 200 with the order cancelled or refunded, 401 without a valid token, 403 for a non-customer, 404 for an unknown or foreign order and 409 E_ORDER_STATE for a paid order inside 24 hours of its event or an expired, cancelled or refunded order"
input_classes:
  - name: typical_held_cancel
    input: "POST /orders/<id>/cancel with the order's customer token on a held order"
    expected: "200 with status \"cancelled\""
  - name: boundary_refund_24h_plus_1s
    input: "POST /orders/<id>/cancel for a paid order on an event starting 24 hours and 1 second later"
    expected: "200 with status \"refunded\""
  - name: invalid_refund_inside_window
    input: "POST /orders/<id>/cancel for a paid order on an event starting 23 hours later"
    expected: "409 E_ORDER_STATE"
  - name: invalid_expired_order
    input: "POST /orders/<id>/cancel after the hold's expiresAt"
    expected: "409 E_ORDER_STATE"
  - name: invalid_cancelled_order
    input: "POST /orders/<id>/cancel on an order already cancelled"
    expected: "409 E_ORDER_STATE"
  - name: invalid_foreign_order
    input: "POST /orders/<id>/cancel with another customer's token"
    expected: "404 E_NOT_FOUND"
  - name: empty_unknown_order
    input: "POST /orders/no-such-order/cancel with a customer token"
    expected: "404 E_NOT_FOUND"
  - name: invalid_organizer_role
    input: "POST /orders/<id>/cancel with an organizer token"
    expected: "403 E_FORBIDDEN"
negative_oracle:
  - input_class: invalid_refund_inside_window
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status refunded, since GET /orders/<id> still reports paid"
  - input_class: invalid_expired_order
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status cancelled"
  - input_class: invalid_cancelled_order
    must_fail_with: "E_ORDER_STATE"
    must_not: "a second 200 body"
  - input_class: invalid_foreign_order
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 answer"
  - input_class: invalid_organizer_role
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 200 body"
assertion_summary:
  - "the 200 body of a held order carries status \"cancelled\" and of a paid order status \"refunded\""
  - "the tickets of the cancelled or refunded order stop counting in available, which grows by them unless a waitlist order takes them"
  - "the discount use of the order returns, observable through a maxUses 1 code accepting a new checkout"
feasibility: feasible
```

### box-office:CTR-011

```yaml
id: box-office:CTR-011
template: Contract
obligation: "GET /orders/:id answers 200 with the order for its customer and the event's organizer and 404 E_NOT_FOUND for any other caller or an unknown id, with 401 for a missing or invalid token"
input_classes:
  - name: typical_customer
    input: "GET /orders/<id> with the placing customer's token"
    expected: "200 with the order's id, eventId, customerId, status, items, subtotalCents, discountCode, discountCents, totalCents, createdAt, expiresAt and paidAt"
  - name: typical_organizer
    input: "GET /orders/<id> with the event organizer's token"
    expected: "200 with the same order body as the customer receives"
  - name: empty_unknown_id
    input: "GET /orders/no-such-order with any valid token"
    expected: "404 E_NOT_FOUND"
  - name: invalid_third_account
    input: "GET /orders/<id> with a third account's token"
    expected: "404 E_NOT_FOUND"
  - name: invalid_no_token
    input: "GET /orders/<id> with no Authorization header"
    expected: "401 E_UNAUTHENTICATED"
negative_oracle:
  - input_class: invalid_third_account
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 body and a 403 answer"
  - input_class: empty_unknown_id
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 body"
  - input_class: invalid_no_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 404 answer"
assertion_summary:
  - "the bodies read by the customer and by the organizer carry the same id, status and items"
  - "every 200 body carries the full order shape and no account fields beyond ids"
feasibility: feasible
```

### box-office:CTR-012

```yaml
id: box-office:CTR-012
template: Contract
obligation: "GET /me/orders answers 200 with an array of the caller's orders newest first, 401 without a valid token and 403 E_FORBIDDEN for a non-customer"
input_classes:
  - name: typical_no_orders
    input: "GET /me/orders with the token of a customer who placed no order"
    expected: "200 with an empty JSON array"
  - name: typical_one_order
    input: "GET /me/orders with the token of a customer holding one order"
    expected: "200 with an array of length 1"
  - name: typical_distinct_instants
    input: "GET /me/orders after the caller placed three orders at distinct instants"
    expected: "200 with three elements in descending createdAt order"
  - name: empty_absent_token
    input: "GET /me/orders with no Authorization header"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_organizer_role
    input: "GET /me/orders with an organizer token"
    expected: "403 E_FORBIDDEN"
negative_oracle:
  - input_class: invalid_organizer_role
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 200 array body"
  - input_class: empty_absent_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 403 answer"
assertion_summary:
  - "the body is a JSON array whose elements each use the order shape"
  - "createdAt of the elements descends from first to last"
  - "no element's customerId differs from the caller's id"
feasibility: feasible
```

### box-office:CTR-013

```yaml
id: box-office:CTR-013
template: Contract
obligation: "POST /events/:id/discounts answers 201 with the upper-case code, uses 0 and null absent fields, 400 E_INVALID_INPUT for each field rule, 401, 403 for a non-organizer or another organizer, 404 E_NOT_FOUND for an unknown event and 409 E_CODE_TAKEN for a repeat code in any case"
input_classes:
  - name: typical_percent_only
    input: "POST /events/<id>/discounts with the organizer token and {\"code\": \"earlybird\", \"percentOff\": 25}"
    expected: "201 with code \"EARLYBIRD\", percentOff 25, amountOffCents null, maxUses null, expiresAt null and uses 0"
  - name: typical_amount_only
    input: "POST /events/<id>/discounts with {\"code\": \"FIVEOFF\", \"amountOffCents\": 500, \"maxUses\": 3, \"expiresAt\": \"2027-01-01T00:00:00Z\"}"
    expected: "201 with percentOff null, amountOffCents 500, maxUses 3 and expiresAt in the millisecond, Z-terminated form"
  - name: boundary_code_3
    input: "POST /events/<id>/discounts with a 3-character alphanumeric code"
    expected: "201"
  - name: boundary_code_20
    input: "POST /events/<id>/discounts with a 20-character alphanumeric code"
    expected: "201"
  - name: empty_neither_discount
    input: "POST /events/<id>/discounts with {\"code\": \"NONE\"}"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_both_discounts
    input: "POST /events/<id>/discounts with both percentOff 10 and amountOffCents 500"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_code_short
    input: "POST /events/<id>/discounts with code \"ab\""
    expected: "400 E_INVALID_INPUT"
  - name: invalid_unknown_event
    input: "POST /events/no-such-event/discounts with a valid body"
    expected: "404 E_NOT_FOUND"
  - name: invalid_not_owner
    input: "POST /events/<id>/discounts with another organizer's token"
    expected: "403 E_FORBIDDEN"
  - name: invalid_repeat_code
    input: "POST /events/<id>/discounts with code \"EarlyBird\" after \"earlybird\" was created"
    expected: "409 E_CODE_TAKEN"
negative_oracle:
  - input_class: empty_neither_discount
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body"
  - input_class: invalid_both_discounts
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a stored code, observable through a later checkout with it answering 201"
  - input_class: invalid_code_short
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body"
  - input_class: invalid_not_owner
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 201 body"
  - input_class: invalid_repeat_code
    must_fail_with: "E_CODE_TAKEN"
    must_not: "a 201 body and a second code record"
  - input_class: invalid_unknown_event
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 400 answer for a field rule"
assertion_summary:
  - "the code of every 201 body is the submitted code upper-cased"
  - "uses is 0 and every absent optional field is null in the 201 body"
  - "every rejection body is a JSON object with the key error"
feasibility: feasible
```

### box-office:CTR-014

```yaml
id: box-office:CTR-014
template: Contract
obligation: "POST /events/:id/waitlist answers 201 with id, eventId, tierId, quantity and position, 400 E_INVALID_INPUT for a quantity outside 1-6 or a missing tierId, 401, 403 for a non-customer, 404 E_NOT_FOUND for an unknown event, 400 E_INVALID_TIER for a tier of another event, 409 E_TICKETS_AVAILABLE when tickets suffice and 409 E_ALREADY_WAITING for a second entry"
input_classes:
  - name: typical_shortfall
    input: "POST /events/<id>/waitlist with a customer token, {\"tierId\": \"<tier with available 0>\", \"quantity\": 2}"
    expected: "201 with position 1 and that tier's available unchanged"
  - name: boundary_quantity_6
    input: "POST /events/<id>/waitlist with quantity 6 on a tier with available 0"
    expected: "201 with quantity 6"
  - name: invalid_quantity_7
    input: "POST /events/<id>/waitlist with quantity 7"
    expected: "400 E_INVALID_INPUT"
  - name: empty_missing_tier_id
    input: "POST /events/<id>/waitlist with body {\"quantity\": 1}"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_tier_of_other_event
    input: "POST /events/<id of event A>/waitlist with a tierId of event B"
    expected: "400 E_INVALID_TIER"
  - name: invalid_tickets_available
    input: "POST /events/<id>/waitlist with quantity 2 on a tier with available 2"
    expected: "409 E_TICKETS_AVAILABLE"
  - name: invalid_already_waiting
    input: "the same customer posts the same tier twice with quantity 1 on a tier with available 0"
    expected: "409 E_ALREADY_WAITING on the second call"
  - name: invalid_unknown_event
    input: "POST /events/no-such-event/waitlist with a valid body"
    expected: "404 E_NOT_FOUND"
  - name: invalid_organizer_role
    input: "POST /events/<id>/waitlist with an organizer token"
    expected: "403 E_FORBIDDEN"
negative_oracle:
  - input_class: invalid_quantity_7
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 entry body"
  - input_class: invalid_tickets_available
    must_fail_with: "E_TICKETS_AVAILABLE"
    must_not: "a 201 entry body"
  - input_class: invalid_already_waiting
    must_fail_with: "E_ALREADY_WAITING"
    must_not: "a second entry body for that tier"
  - input_class: invalid_tier_of_other_event
    must_fail_with: "E_INVALID_TIER"
    must_not: "a 201 entry body naming a tier outside the event"
  - input_class: invalid_unknown_event
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 400 or 409 answer"
  - input_class: invalid_organizer_role
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 201 entry body"
assertion_summary:
  - "the 201 body carries exactly id, eventId, tierId, quantity and position"
  - "position counts from 1 within the tier's queue"
  - "no accepted or rejected join changes a tier's available"
feasibility: feasible
```

### box-office:CTR-015

```yaml
id: box-office:CTR-015
template: Contract
obligation: "GET /events/:id/report answers 200 with eventId, the tier rows, grossCents, discountCents, refundedCents and netCents for the event's organizer, with 401, 403 for a non-organizer or another organizer and 404 E_NOT_FOUND for an unknown event"
input_classes:
  - name: typical_paid_with_discount
    input: "GET /events/<id>/report with the organizer token for an event with one paid order of subtotalCents 2000 and discountCents 400"
    expected: "200 with grossCents 2000, discountCents 400, netCents 1600, refundedCents 0 and one tiers row per tier with tierId, name, sold, held and available"
  - name: typical_held_order
    input: "GET /events/<id>/report for an event with one held order"
    expected: "200 with that tier's held equal to the held tickets and sold 0, and netCents 0"
  - name: empty_no_orders
    input: "GET /events/<id>/report for an event with no orders"
    expected: "200 with every sum 0 and each tier's sold 0 and held 0"
  - name: boundary_refunded_order
    input: "GET /events/<id>/report for an event whose only paid order was refunded"
    expected: "200 with refundedCents equal to that order's totalCents, grossCents 0 and netCents 0"
  - name: invalid_not_organizer
    input: "GET /events/<id>/report with a customer token"
    expected: "403 E_FORBIDDEN"
  - name: invalid_unknown_event
    input: "GET /events/no-such-event/report with an organizer token"
    expected: "404 E_NOT_FOUND"
  - name: invalid_no_token
    input: "GET /events/<id>/report with no Authorization header"
    expected: "401 E_UNAUTHENTICATED"
negative_oracle:
  - input_class: invalid_not_organizer
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 200 report body"
  - input_class: invalid_unknown_event
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 200 report body"
  - input_class: invalid_no_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 403 answer and a report body"
assertion_summary:
  - "the body carries eventId, tiers, grossCents, discountCents, refundedCents and netCents"
  - "each tier row carries tierId, name, sold, held and available with sold counting paid tickets only"
  - "netCents equals grossCents minus discountCents"
feasibility: feasible
```

### box-office:INV-001

```yaml
id: box-office:INV-001
template: Invariant
obligation: "never does any response body of any endpoint contain the password of a registered account"
input_classes:
  - name: typical_registration
    input: "POST /users with password \"correct-horse\" and then POST /users with the same email in another case"
    expected: "201 then 409; neither body contains the string \"correct-horse\" and neither carries a key named password"
  - name: typical_session
    input: "POST /sessions with {\"email\": \"ada@example.com\", \"password\": \"correct-horse\"}"
    expected: "200 whose body holds the key token only and no password value"
  - name: typical_get_me
    input: "GET /me with the token of that account"
    expected: "200 whose keys are id, email, name and role, with no password value"
  - name: empty_no_token
    input: "GET /me with no Authorization header"
    expected: "401 E_UNAUTHENTICATED whose body carries the key error and no account data"
  - name: boundary_error_bodies
    input: "POST /orders with an invalid body and GET /events?pageSize=51 and POST /users with an invalid role"
    expected: "400 E_INVALID_INPUT, 400 E_INVALID_QUERY and 400 E_INVALID_INPUT; no body of any of them contains a registered password"
negative_oracle:
  - input_class: empty_no_token
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a body carrying email, name or role"
assertion_summary:
  - "no response body of this block contains the registered password text in any key or value"
  - "no response body carries a key named password"
  - "the 401 body carries the key error only"
feasibility: feasible
```

### box-office:INV-002

```yaml
id: box-office:INV-002
template: Invariant
obligation: "every monetary value in every response is an integer number of cents, whatever the price, the percentage or the amount off"
input_classes:
  - name: typical_price_0
    input: "POST /events with a tier of priceCents 0, then GET /events/<id>"
    expected: "201 and 200 with priceCents 0 and available as integers"
  - name: typical_percent_fraction
    input: "POST /orders with a code of percentOff 33 for a subtotal of 1000"
    expected: "201 with discountCents 330 and totalCents 670, both JSON integers"
  - name: typical_amount_above_subtotal
    input: "POST /orders with a code of amountOffCents 5000 for a subtotal of 1000"
    expected: "201 with discountCents 1000 and totalCents 0, both JSON integers"
  - name: empty_report_no_orders
    input: "GET /events/<id>/report for an event with no orders"
    expected: "200 with grossCents, discountCents, refundedCents and netCents all the integer 0"
  - name: invalid_price_fraction
    input: "POST /events with priceCents 15.5"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
negative_oracle:
  - input_class: invalid_price_fraction
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 body carrying priceCents 15.5"
assertion_summary:
  - "every monetary field of every response in this block is a JSON integer without a fractional part"
  - "the fields covered are priceCents, unitPriceCents, subtotalCents, discountCents, totalCents, amountOffCents, grossCents, refundedCents and netCents"
  - "no response carries a monetary value as a string or a floating point number"
feasibility: feasible
```

### box-office:INV-003

```yaml
id: box-office:INV-003
template: Invariant
obligation: "every id the API hands out is a JSON string and no two ids of any two records are equal"
input_classes:
  - name: typical_two_accounts
    input: "POST /users twice with distinct emails"
    expected: "201 twice with two id values that are strings and differ"
  - name: typical_two_events_with_tiers
    input: "POST /events twice, each with two tiers"
    expected: "201 twice; the two event ids and the four tier ids are five distinct strings"
  - name: typical_order_and_waitlist
    input: "POST /orders and POST /events/<id>/waitlist in the same process"
    expected: "201 twice with an order id and a waitlist entry id that are strings and differ"
  - name: empty_single_event
    input: "POST /events with one tier"
    expected: "201 whose event id and tier id are both JSON strings"
negative_oracle: []
assertion_summary:
  - "every id value appearing in a response is a JSON string, never a number"
  - "the set of ids collected from all responses of a run has no duplicate members"
  - "the ids compared span accounts, events, tiers, orders, discount codes and waitlist entries"
feasibility: feasible
```

### box-office:INV-004

```yaml
id: box-office:INV-004
template: Invariant
obligation: "every submitted time is accepted in any form the platform's time parser reads and every time a response carries is the millisecond, Z-terminated form of that instant"
input_classes:
  - name: typical_short_form
    input: "POST /events with startsAt \"2027-11-02T18:00:00Z\""
    expected: "201 with startsAt \"2027-11-02T18:00:00.000Z\""
  - name: typical_offset_form
    input: "POST /events with startsAt \"2027-11-02T20:00:00+02:00\""
    expected: "201 with startsAt \"2027-11-02T18:00:00.000Z\""
  - name: empty_no_time_bearing_field
    input: "POST /users with a valid body"
    expected: "201 whose body carries no time field at all"
  - name: boundary_order_times
    input: "POST /orders for one ticket with HOLD_SECONDS 600"
    expected: "201 with createdAt and expiresAt both in the millisecond, Z-terminated form, and the same form for paidAt after paying"
  - name: invalid_missing_starts_at
    input: "POST /events with no startsAt field"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
negative_oracle:
  - input_class: invalid_missing_starts_at
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 201 event body"
assertion_summary:
  - "every time value in a response matches the form YYYY-MM-DDTHH:MM:SS.sssZ"
  - "a time submitted in the short or offset form is echoed as the same instant in that form, never as the submitted text"
  - "no response carries a time without milliseconds or with an offset suffix"
feasibility: feasible
```

### box-office:INV-005

```yaml
id: box-office:INV-005
template: Invariant
obligation: "after every state change a tier's available always equals its quantity minus its tickets in held orders minus its tickets in paid orders, waitlist-created holds included and every order in another status counted in neither"
input_classes:
  - name: typical_no_orders
    input: "GET /events/<id> of a freshly created event with three tiers"
    expected: "200 with each tier's available equal to its quantity"
  - name: boundary_fully_held
    input: "POST /orders for the whole quantity of a tier, then GET /events/<id>"
    expected: "201 then 200 with that tier's available 0"
  - name: boundary_refunded_order
    input: "a paid order is refunded, then GET /events/<id>"
    expected: "the tier's available equals its quantity minus the tickets still in held and paid orders, the refunded order counted in neither"
  - name: boundary_waitlist_took
    input: "a held order expires while a waitlist entry of the same quantity waits, then GET /events/<id>"
    expected: "available equals quantity minus the tickets of the new held order created for the waiting customer"
  - name: invalid_oversell
    input: "POST /orders for one ticket more than a tier's available"
    expected: "409 E_TICKETS_UNAVAILABLE and the same available as before"
negative_oracle:
  - input_class: invalid_oversell
    must_fail_with: "E_TICKETS_UNAVAILABLE"
    must_not: "a negative available and a held order that fits only part of the request"
assertion_summary:
  - "available is a JSON integer and never negative in any response"
  - "after each of the create, expire, cancel, refund and waitlist-serving events of this block, available equals quantity minus held tickets minus paid tickets"
  - "no response counts an expired, cancelled or refunded order in available"
feasibility: feasible
```

### box-office:INV-006

```yaml
id: box-office:INV-006
template: Invariant
obligation: "no sequence of holds, payments and waitlist servings ever leaves one customer holding or owning more than 6 tickets of one event"
input_classes:
  - name: boundary_six_in_one_order
    input: "POST /orders with one item of quantity 6"
    expected: "201 held with 6 tickets and no more"
  - name: boundary_six_across_two_orders
    input: "POST /orders twice, first 4 tickets then 2 tickets"
    expected: "201 twice and a total of 6 tickets across the customer's held and paid orders in GET /me/orders"
  - name: invalid_seventh_ticket
    input: "a customer holding 6 tickets posts POST /orders for 1 more"
    expected: "422 E_TICKET_LIMIT with a body carrying the key error"
  - name: boundary_waitlist_at_limit
    input: "a customer holding 5 tickets waits for 2 tickets and 2 tickets are freed"
    expected: "no order is created for that customer, so its ticket count stays 5"
negative_oracle:
  - input_class: invalid_seventh_ticket
    must_fail_with: "E_TICKET_LIMIT"
    must_not: "a 201 order and a ticket count of 7 in GET /me/orders"
assertion_summary:
  - "the sum of quantities in a customer's held and paid orders for one event never exceeds 6 in any response"
  - "the limit applies across several orders and across waitlist serving as well as direct checkout"
  - "the count includes paid orders, not only held ones"
feasibility: feasible
```

### box-office:INV-007

```yaml
id: box-office:INV-007
template: Invariant
obligation: "no response ever reports a held order past its expiresAt as held, its tickets stop counting as held, and an order in another status keeps it, a paid order past its former expiresAt included"
input_classes:
  - name: typical_still_held
    input: "GET /orders/<id> one second before expiresAt, with HOLD_SECONDS 5"
    expected: "200 with status \"held\""
  - name: boundary_expired_no_waitlist
    input: "with HOLD_SECONDS 1, a held order of 1 ticket on a tier with no waitlist entry, read one second after its expiresAt through GET /orders/<id>, GET /me/orders and GET /events/<id>"
    expected: "every read reports \"expired\"; the tier's available grew by that ticket"
  - name: boundary_expired_with_waitlist
    input: "the same with a waitlist entry of 1 ticket on that tier"
    expected: "the order reports \"expired\", the freed ticket is held by the waiting customer's new order, and the tier's available equals quantity minus held and paid tickets"
  - name: boundary_paid_past_expiry
    input: "a paid order read after its former expiresAt through GET /orders/<id> and GET /me/orders"
    expected: "both report \"paid\" and never \"expired\""
  - name: invalid_pay_expired
    input: "POST /orders/<id>/pay after the hold's expiresAt"
    expected: "409 E_ORDER_STATE"
negative_oracle:
  - input_class: invalid_pay_expired
    must_fail_with: "E_ORDER_STATE"
    must_not: "a 200 body with status paid and a paidAt value"
assertion_summary:
  - "no response of this block carries status held for an order whose expiresAt lies in the past"
  - "a paid order's status is never rewritten by the passage of its former expiresAt"
  - "the tickets of an expired order are either available or held by one waitlist-created order, in no case counted twice"
feasibility: feasible
```

### box-office:INV-008

```yaml
id: box-office:INV-008
template: Invariant
obligation: "every failed request answers a status in 400, 401, 403, 404, 409 or 422 with a JSON body of the shape {\"error\": \"<any message>\"}"
input_classes:
  - name: typical_400_failure
    input: "POST /users with role \"customer\" and a password of 7 characters"
    expected: "400 whose body is a JSON object carrying the key error"
  - name: typical_404_failure
    input: "GET /events/no-such-event"
    expected: "404 whose body is a JSON object carrying the key error"
  - name: typical_422_failure
    input: "POST /orders that would take a customer to 7 tickets"
    expected: "422 whose body is a JSON object carrying the key error"
  - name: empty_unknown_route
    input: "GET /nope with no Authorization header"
    expected: "404 whose body is a JSON object carrying the key error"
  - name: invalid_json_body
    input: "POST /users with a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON whose body is a JSON object carrying the key error"
negative_oracle:
  - input_class: invalid_json_body
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a body lacking the key error and a status outside 400, 401, 403, 404, 409, 422"
  - input_class: typical_422_failure
    must_fail_with: "E_TICKET_LIMIT"
    must_not: "a 200 status and a free-text body"
assertion_summary:
  - "every failure body parses as a JSON object whose key error holds a non-empty string"
  - "no failure answers with an empty body, a free-text body or a status outside 400, 401, 403, 404, 409, 422"
  - "each failure carries exactly one status"
feasibility: feasible
```

### box-office:INV-009

```yaml
id: box-office:INV-009
template: Invariant
obligation: "a discount code is stored and returned upper case, matched case-insensitively everywhere, and its uses always equals the number of the event's held and paid orders carrying it"
input_classes:
  - name: typical_lower_case_submission
    input: "POST /events/<id>/discounts with code \"earlybird\""
    expected: "201 with code \"EARLYBIRD\""
  - name: typical_mixed_case_checkout
    input: "POST /orders with discountCode \"EarlyBird\" for the stored \"EARLYBIRD\""
    expected: "201 with discountCode \"EARLYBIRD\" and the discount applied"
  - name: boundary_expiring_order
    input: "a checkout with a maxUses 1 code whose order then expires with HOLD_SECONDS 1, then a new checkout with the same code in another case"
    expected: "the held order spends the use, the new checkout answers 201, so uses returned to 0"
  - name: boundary_used_up_after_second
    input: "a maxUses 1 code checked out twice while the first order is held"
    expected: "the second checkout answers 422 E_DISCOUNT_UNUSABLE"
  - name: empty_no_code
    input: "a checkout without a discountCode"
    expected: "201 with discountCode null and discountCents 0"
negative_oracle:
  - input_class: boundary_used_up_after_second
    must_fail_with: "E_DISCOUNT_UNUSABLE"
    must_not: "a 201 body carrying the code"
assertion_summary:
  - "every response carrying a discount code reports it in upper case"
  - "a case-different submission is never treated as a separate unknown code"
  - "uses rises with each held or paid order carrying the code and falls when such an order expires, is cancelled or is refunded, observable through the maxUses boundary"
feasibility: feasible
```

### box-office:INV-010

```yaml
id: box-office:INV-010
template: Invariant
obligation: "no waitlist entry is served while the entry ahead of it in that tier's queue remains unserved and does not fit"
input_classes:
  - name: typical_first_fits
    input: "tier of quantity 2 with entry E1 of quantity 2 at position 1 and entry E2 of quantity 1 at position 2; a held order of 2 tickets expires"
    expected: "E1's customer holds one new order for 2 tickets, E2's customer holds none, and available ends at 0"
  - name: boundary_first_does_not_fit
    input: "tier of quantity 4 with a held order of 3, a held order of 1, entry E1 of quantity 3 at position 1 and entry E2 of quantity 1 at position 2; the held order of 1 is cancelled"
    expected: "available becomes 1 and neither E1's nor E2's customer gains an order"
  - name: boundary_limit_removal
    input: "an over-limit first entry of quantity 2 for a customer holding 5 tickets, with a later entry of quantity 1, while 2 tickets are freed"
    expected: "the over-limit entry is dropped, the later entry receives a held order for 1 ticket and 1 ticket stays available"
  - name: empty_queue
    input: "a tier with no waitlist entry while a held order expires"
    expected: "no order is created and available grows by the expired quantity"
negative_oracle: []
assertion_summary:
  - "no customer queued behind a first entry that does not fit gains an order in any serving round"
  - "the queue order is preserved across rounds: a later entry is served only after the entries ahead of it have been served or dropped"
  - "the tier's available after each round equals quantity minus held and paid tickets"
feasibility: feasible
```

### box-office:INV-011

```yaml
id: box-office:INV-011
template: Invariant
obligation: "a request's status is decided by the first failing check in the order route and method, then body syntax, then token 401, role 403, input 400, named resource 404, ownership 403, state 409, limits 422"
input_classes:
  - name: typical_unknown_route_no_token
    input: "GET /nope with no Authorization header"
    expected: "404 E_NOT_FOUND"
  - name: boundary_unserved_method
    input: "PUT /events with an organizer token and a valid body"
    expected: "404 E_NOT_FOUND"
  - name: boundary_malformed_body_no_token
    input: "POST /events with no token and a body that is not valid JSON"
    expected: "400 E_MALFORMED_JSON"
  - name: invalid_token_before_input
    input: "POST /events with no token and tiers: []"
    expected: "401 E_UNAUTHENTICATED"
  - name: invalid_wrong_role_invalid_input
    input: "POST /events with a customer token and tiers: []"
    expected: "403 E_FORBIDDEN"
  - name: invalid_unknown_name_wrong_state
    input: "POST /events/no-such-event/cancel by an organizer on an id no event carries"
    expected: "404 E_NOT_FOUND"
  - name: invalid_wrong_owner_wrong_state
    input: "POST /events/<cancelled event>/cancel with another organizer's token"
    expected: "403 E_FORBIDDEN"
  - name: invalid_state_before_limit
    input: "POST /orders for a cancelled event by a customer already holding 6 tickets"
    expected: "409 E_EVENT_NOT_ON_SALE"
negative_oracle:
  - input_class: typical_unknown_route_no_token
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 401 answer"
  - input_class: boundary_malformed_body_no_token
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a 401 answer"
  - input_class: invalid_token_before_input
    must_fail_with: "E_UNAUTHENTICATED"
    must_not: "a 400 answer"
  - input_class: invalid_wrong_role_invalid_input
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 400 answer"
  - input_class: invalid_unknown_name_wrong_state
    must_fail_with: "E_NOT_FOUND"
    must_not: "a 403 or a 409 answer"
  - input_class: invalid_wrong_owner_wrong_state
    must_fail_with: "E_FORBIDDEN"
    must_not: "a 409 answer"
  - input_class: invalid_state_before_limit
    must_fail_with: "E_EVENT_NOT_ON_SALE"
    must_not: "a 422 answer"
assertion_summary:
  - "each request answers exactly one status, equal to the status of its first failing check"
  - "no answer reflects a check that comes later in the stated order"
  - "each failure body carries the key error"
feasibility: feasible
```

### box-office:POL-001

```yaml
id: box-office:POL-001
template: Policy
obligation: "every failure of every endpoint answers a status in 400, 401, 403, 404, 409 or 422 with a JSON body holding the key error, whose message text is free and never asserted"
input_classes:
  - name: typical_400_failure
    input: "POST /users with role \"admin\""
    expected: "400 whose body is a JSON object with the key error"
  - name: typical_409_failure
    input: "POST /users with an email already registered"
    expected: "409 whose body is a JSON object with the key error"
  - name: typical_422_failure
    input: "POST /orders that would take a customer past 6 tickets"
    expected: "422 whose body is a JSON object with the key error"
  - name: empty_unknown_route
    input: "GET /nope with no Authorization header"
    expected: "404 whose body is a JSON object with the key error"
  - name: boundary_401_failure
    input: "GET /me with no Authorization header"
    expected: "401 whose body is a JSON object with the key error"
negative_oracle:
  - input_class: typical_400_failure
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a 200 status, and a body whose failure signal is free text outside the key error"
  - input_class: typical_409_failure
    must_fail_with: "E_EMAIL_TAKEN"
    must_not: "a 409 with an empty body"
  - input_class: typical_422_failure
    must_fail_with: "E_TICKET_LIMIT"
    must_not: "a status outside 400, 401, 403, 404, 409, 422"
assertion_summary:
  - "every failure body parses as a JSON object and carries the key error holding a non-empty string"
  - "no failure answers with an empty, HTML or free-text body"
  - "the message text is never asserted, so no test depends on it"
  - "no failure answers 2xx"
feasibility: feasible
```

### box-office:POL-002

```yaml
id: box-office:POL-002
template: Policy
obligation: "an invalid or missing input yields the endpoint's stated 4xx response with the error body and leaves the process serving the next request"
input_classes:
  - name: typical_invalid_json
    input: "POST /users with a body that is not valid JSON, then GET /events"
    expected: "400 E_MALFORMED_JSON followed by 200 with the page body"
  - name: boundary_non_object_body
    input: "POST /events with an organizer token and body []"
    expected: "400 E_INVALID_INPUT with a body carrying the key error"
  - name: invalid_missing_required_field
    input: "POST /users with {\"email\": \"c@example.com\", \"name\": \"Cy\", \"role\": \"customer\"} and no password"
    expected: "400 E_INVALID_INPUT"
  - name: invalid_wrong_value_type
    input: "POST /events with an organizer token and a tier whose quantity is the string \"two\""
    expected: "400 E_INVALID_INPUT"
  - name: empty_two_invalid_in_a_row
    input: "POST /users with a malformed body, then POST /events with a malformed body, then GET /events"
    expected: "400, then 400, then 200 with the page body"
negative_oracle:
  - input_class: invalid_wrong_value_type
    must_fail_with: "E_INVALID_INPUT"
    must_not: "a dropped connection or a next request left unanswered"
  - input_class: typical_invalid_json
    must_fail_with: "E_MALFORMED_JSON"
    must_not: "a status outside 400, 401, 403, 404, 409, 422 and a process that stops answering"
assertion_summary:
  - "both invalid requests answer with the stated status and a JSON body carrying the key error"
  - "the request that follows the invalid ones answers 200 with its normal body"
  - "no response of this block carries a stack trace text or closes the connection without a status"
feasibility: feasible
```

## 4. Infeasible candidates

none
