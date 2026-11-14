import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { costarProperties, costarSpaces } from "@/lib/db/costar-schema";
import { SiteInventorySchema } from "@/lib/contracts/sites";

/** Select only search inputs; raw broker/attachment payloads stay in Postgres. */
export async function loadSiteInventory() {
  return getDb().transaction(
    async (tx) => {
      const [properties, spaces] = await Promise.all([
        tx
          .select({
            id: costarProperties.id,
            city: costarProperties.city,
            latitude: costarProperties.latitude,
            longitude: costarProperties.longitude,
            retail: costarProperties.retail,
            source: costarProperties.source,
            data: sql<Record<string, unknown>>`jsonb_build_object(
          'buildingName', ${costarProperties.data}->'buildingName',
          'primaryAddress', jsonb_build_object(
            'streetNumber', ${costarProperties.data}->'primaryAddress'->'streetNumber',
            'streetDirection', ${costarProperties.data}->'primaryAddress'->'streetDirection',
            'streetName', ${costarProperties.data}->'primaryAddress'->'streetName',
            'streetType', ${costarProperties.data}->'primaryAddress'->'streetType',
            'streetSuffix', ${costarProperties.data}->'primaryAddress'->'streetSuffix'
          ),
          'propertyRetail', jsonb_build_object('frontage', ${costarProperties.data}->'propertyRetail'->'frontage'),
          'parking', ${costarProperties.data}->'parking',
          'parkingRatio', ${costarProperties.data}->'parkingRatio',
          'provenance', ${costarProperties.data}->'provenance'
        )`,
          })
          .from(costarProperties),
        tx
          .select({
            id: costarSpaces.id,
            listingId: costarSpaces.listingId,
            propertyId: costarSpaces.propertyId,
            active: costarSpaces.active,
            retail: costarSpaces.retail,
            sizeSqFt: costarSpaces.sizeSqFt,
            source: costarSpaces.source,
            data: sql<Record<string, unknown>>`jsonb_build_object(
          'spaceUse', ${costarSpaces.data}->'spaceUse',
          'position', ${costarSpaces.data}->'position',
          'floor', ${costarSpaces.data}->'floor',
          'askingRentUsdPerSfYearLow', ${costarSpaces.data}->'askingRentUsdPerSfYearLow',
          'askingRentUsdPerSfYearHigh', ${costarSpaces.data}->'askingRentUsdPerSfYearHigh',
          'serviceTypeName', ${costarSpaces.data}->'serviceTypeName',
          'provenance', ${costarSpaces.data}->'provenance'
        )`,
          })
          .from(costarSpaces),
      ]);
      // The kit has no verified anchor-tenant field. Search marks this attribute
      // unknown rather than inferring it from tenant names or size.
      return SiteInventorySchema.parse({
        properties,
        spaces,
        tenancies: [],
        synthetic: false,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
