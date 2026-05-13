exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API key not configured. Please set ANTHROPIC_API_KEY in Netlify environment variables." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const { mode, url, imageBase64, mediaType } = body;

  // ── Build the message content ──
  let messageContent;
  const jsonInstructions = `Return ONLY a valid JSON object. No explanation, no markdown, no backticks — just raw JSON.

Required fields:
{
  "name": "Recipe name",
  "category": "Baking" or "Cooking",
  "difficulty": "Easy" or "Medium" or "Hard",
  "prep": integer minutes (0 if unknown),
  "cook": integer minutes (0 if unknown),
  "rest": integer minutes (0 if unknown or not applicable),
  "servings": integer (4 if unknown),
  "description": "1-2 sentence description",
  "ingredients": ["ingredient 1", "ingredient 2"],
  "steps": ["Step 1", "Step 2"],
  "nutrition": { "calories": integer, "protein": integer, "carbs": integer, "fat": integer }
}

Rules:
- category must be exactly "Baking" or "Cooking"
- difficulty must be exactly "Easy", "Medium", or "Hard"
- rest is only relevant for Baking (proofing, cooling, chilling, resting dough); use 0 for Cooking
- All nutrition values are integers (0 if unknown)
- Return valid JSON only`;

  if (mode === "url") {
    // Fetch the page server-side (no CORS issues here)
    let pageText = "";
    if (url) {
      try {
        const pageRes = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeVaultBot/1.0)" },
          signal: AbortSignal.timeout(8000),
        });
        const html = await pageRes.text();
        // Strip tags to plain text
        pageText = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
      } catch (e) {
        pageText = `Recipe from URL: ${url}`;
      }
    }

    messageContent = `Extract a recipe from this webpage text and ${jsonInstructions}\n\nWebpage content:\n${pageText}`;

  } else if (mode === "image") {
    if (!imageBase64 || !mediaType) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing image data." }) };
    }
    messageContent = [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: imageBase64 },
      },
      {
        type: "text",
        text: `Look at this image and extract any recipe information visible. ${jsonInstructions}\n\nIf the image is a photo of a finished dish with no recipe text, still name the dish and estimate a plausible recipe.`,
      },
    ];
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid mode. Use 'url' or 'image'." }) };
  }

  // ── Call Anthropic ──
  try {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20251001",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: messageContent,
          },
        ],
      }),
    });

    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      return {
        statusCode: aiRes.status,
        body: JSON.stringify({ error: aiData.error?.message || "API error" }),
      };
    }

    const rawText = (aiData.content || [])
      .map((b) => b.text || "")
      .join("")
      .trim();

    // Parse and validate JSON
    let extracted;
    try {
      extracted = JSON.parse(rawText.replace(/```json|```/gi, "").trim());
    } catch (e) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Could not parse recipe data from response." }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(extracted),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unexpected server error." }),
    };
  }
};
