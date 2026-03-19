import { getDigestData } from "../../src/lib/digest";

export default async () => {
  try {
    const payload = await getDigestData();
    const errorCount = payload.diagnostics.filter((diagnostic) => diagnostic.status === "error").length;
    const emptyCount = payload.diagnostics.filter((diagnostic) => diagnostic.status === "empty").length;

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
        "x-digest-errors": String(errorCount),
        "x-digest-empty": String(emptyCount)
      }
    });
  } catch (error) {
    console.error("Failed to generate digest payload", error);

    return new Response(
      JSON.stringify({
        error: "Failed to generate digest payload."
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8"
        }
      }
    );
  }
};
