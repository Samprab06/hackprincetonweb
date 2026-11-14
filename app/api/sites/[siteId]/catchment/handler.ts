import {
  CatchmentQuerySchema,
  CatchmentResponseSchema,
} from "@/lib/contracts/catchment";
import {
  CatchmentDataUnavailableError,
  CatchmentNotFoundError,
  getCatchment,
} from "@/lib/data/catchment-repository";

type Getter = typeof getCatchment;
const headers = { "Cache-Control": "private, no-store" };

export function createCatchmentHandler(getter: Getter = getCatchment) {
  return async (
    request: Request,
    context: { params: Promise<{ siteId: string }> },
  ) => {
    const { siteId } = await context.params;
    if (!/^\d+(?::\d+)?$/.test(siteId) || siteId.length > 100) {
      return Response.json(
        { error: "Invalid site identifier" },
        { status: 400, headers },
      );
    }
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) {
      return Response.json(
        { error: "Repeated query parameter" },
        { status: 400, headers },
      );
    }
    const parsed = CatchmentQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success)
      return Response.json(
        { error: "Invalid catchment query" },
        { status: 400, headers },
      );
    try {
      const result = await getter(
        siteId,
        parsed.data,
        params.has("radiusMeters") ? "founder" : "default",
      );
      const validated = CatchmentResponseSchema.parse(result);
      return Response.json(validated, { headers });
    } catch (error) {
      if (error instanceof CatchmentNotFoundError)
        return Response.json(
          { error: "Project or site not found" },
          { status: 404, headers },
        );
      if (error instanceof CatchmentDataUnavailableError)
        return Response.json(
          { error: "Catchment source data is unavailable" },
          { status: 503, headers },
        );
      // Driver errors may contain source payloads/connection strings. Never return them.
      return Response.json(
        { error: "Catchment is temporarily unavailable" },
        { status: 503, headers },
      );
    }
  };
}
