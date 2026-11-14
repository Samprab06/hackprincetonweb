export interface DatabaseProbe {
  postgis: boolean;
}

export interface HealthResult {
  status: 200 | 503;
  body: {
    status: "ok" | "error";
    database: { status: string; postgis?: boolean };
    code?: string;
    message?: string;
    field_errors?: Record<string, string[]>;
  };
}

export async function evaluateHealth(
  configured: boolean,
  probe: () => Promise<DatabaseProbe>,
): Promise<HealthResult> {
  if (!configured) {
    return {
      status: 503,
      body: {
        status: "error",
        code: "DATABASE_NOT_CONFIGURED",
        message: "Database configuration is required.",
        field_errors: {},
        database: { status: "not_configured" },
      },
    };
  }

  try {
    const result = await probe();
    if (!result.postgis) {
      return {
        status: 503,
        body: {
          status: "error",
          code: "POSTGIS_UNAVAILABLE",
          message: "The database requires the PostGIS extension.",
          field_errors: {},
          database: { status: "connected", postgis: false },
        },
      };
    }
    return {
      status: 200,
      body: { status: "ok", database: { status: "connected", postgis: true } },
    };
  } catch {
    return {
      status: 503,
      body: {
        status: "error",
        code: "DATABASE_UNAVAILABLE",
        message: "The database is unavailable. Check the server configuration.",
        field_errors: {},
        database: { status: "unavailable" },
      },
    };
  }
}
