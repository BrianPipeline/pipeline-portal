const LINEAR_API = "https://api.linear.app/graphql";

const CLIENT_PREFIX = {
  mackinac: "[MAK]",
  lifeinternational: "[LI]",
  everraise: "[EVR]",
};

const cleanPrefix = (title) => title.replace(/^\[(?:MAK|LI|EVR)\]\s*/, "").trim();

function groupRankByStateType(stateType) {
  // active first, completed last
  if (stateType === "completed") return 2;
  if (stateType === "canceled") return 1;
  return 0;
}

const handler = async (event) => {
  const client = event.queryStringParameters?.client;
  const qRaw = event.queryStringParameters?.q ?? "";
  const q = String(qRaw).trim();

  if (!client || !CLIENT_PREFIX[client]) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid or missing client param" }),
    };
  }
  if (q.length < 3) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ results: [] }),
    };
  }

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "LINEAR_API_KEY not configured" }),
    };
  }

  const prefix = CLIENT_PREFIX[client];

  // Use Linear's full-text search, then restrict to client projects in JS.
  // We also pass a filter to help Linear narrow results when supported.
  const query = `
    query SearchIssues($term: String!, $prefix: String!) {
      searchIssues(
        term: $term
        first: 50
        includeArchived: false
        filter: {
          project: { name: { startsWith: $prefix } }
        }
      ) {
        nodes {
          id
          title
          description
          createdAt
          completedAt
          state { name type }
          labels { nodes { name } }
          project { name }
        }
      }
    }
  `;

  try {
    const response = await fetch(LINEAR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query,
        variables: { term: q, prefix },
      }),
    });

    const json = await response.json();
    if (json.errors) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Linear API error", details: json.errors }),
      };
    }

    const nodes = json.data?.searchIssues?.nodes || [];
    const matchesClientProject = (i) => i.project?.name?.startsWith(prefix);

    const results = nodes
      .filter(matchesClientProject)
      .map((i) => ({
        id: i.id,
        title: cleanPrefix(i.title || ""),
        description: i.description || "",
        createdAt: i.createdAt,
        completedAt: i.completedAt,
        state: { name: i.state?.name || "", type: i.state?.type || "" },
        labels: (i.labels?.nodes || []).map((l) => ({ name: l.name })),
        project: { name: cleanPrefix(i.project?.name || "") },
      }))
      .sort((a, b) => {
        const ra = groupRankByStateType(a.state.type);
        const rb = groupRankByStateType(b.state.type);
        if (ra !== rb) return ra - rb;
        return 0;
      })
      .slice(0, 50);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ results }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Fetch failed", details: err.message }),
    };
  }
};

module.exports = { handler };

