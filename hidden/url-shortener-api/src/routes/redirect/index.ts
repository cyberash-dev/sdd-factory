import { errorResponse } from "../../errors/index.js";
import type { HttpRequest, HttpResponse } from "../../errors/index.js";
import { recordHit } from "../../links/index.js";
import type { LinkStore } from "../../links/index.js";

export interface RedirectRouteDeps {
  readonly store: LinkStore;
}

export function routeRedirect(request: HttpRequest, deps: RedirectRouteDeps): HttpResponse | undefined {
  if (request.method !== "GET") {
    return undefined;
  }
  const segments = request.path.split("/");
  if (segments.length !== 2 || segments[0] !== "" || segments[1] === "") {
    return undefined;
  }
  const link = recordHit(deps.store, segments[1] ?? "");
  if (link === undefined) {
    return errorResponse("not_found");
  }
  return { status: 302, headers: { location: link.url } };
}
