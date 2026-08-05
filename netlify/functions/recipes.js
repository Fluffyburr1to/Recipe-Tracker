const { getStore } = require("@netlify/blobs");

function store() {
  return getStore({
    name: "recipes",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    const data = await store().get("all", { type: "json" });
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data || []),
    };
  }

  if (event.httpMethod === "POST") {
    let recipes;
    try {
      recipes = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: "Invalid JSON" };
    }
    if (!Array.isArray(recipes)) {
      return { statusCode: 400, body: "Expected an array of recipes" };
    }
    await store().setJSON("all", recipes);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: "Method Not Allowed" };
};
