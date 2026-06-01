const LINEAR_API = "https://api.linear.app/graphql";

const CLIENT_PREFIX = {
  mackinac: "[MAK]",
  lifeinternational: "[LI]",
  everraise: "[EVR]",
};

const handler = async (event) => {
  const client = event.queryStringParameters?.client;

  if (!client || !CLIENT_PREFIX[client]) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid or missing client param" }),
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
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // GraphQL query — date filters inlined as strings (Linear uses DateTimeOrDuration scalar)
  const query = `
    query ClientData($prefix: String!) {

      # Issues currently in an active cycle for this client
      cycleIssues: issues(
        filter: {
          project: { name: { startsWith: $prefix } }
          cycle: { isActive: { eq: true } }
        }
        first: 50
      ) {
        nodes {
          id
          title
          description
          priority
          state { name type }
          labels { nodes { name } }
          cycle { name startsAt endsAt }
          project { name }
        }
      }

      # Todo / In Progress issues (Now lane) — cycle issues deduped in JS
      nowIssues: issues(
        filter: {
          project: { name: { startsWith: $prefix } }
          state: { type: { in: ["started", "unstarted"] } }
        }
        first: 50
      ) {
        nodes {
          id
          title
          description
          priority
          state { name type }
          labels { nodes { name } }
          project { name }
        }
      }

      # All backlog ideas for client prefix (newest first)
      ideaIssuesMonth: issues(
        filter: {
          project: { name: { startsWith: $prefix } }
          state: { type: { eq: "backlog" } }
        }
        first: 100
        orderBy: createdAt
      ) {
        nodes {
          id
          title
          createdAt
          state { name type }
          cycle { name }
          labels { nodes { name } }
        }
      }

      ideaIssuesWeek: issues(
        filter: {
          project: { name: { startsWith: $prefix } }
          state: { type: { eq: "backlog" } }
        }
        first: 100
        orderBy: createdAt
      ) {
        nodes {
          id
          title
          createdAt
          state { name type }
          cycle { name }
          labels { nodes { name } }
        }
      }

      # Stat: completed issues count
      completedIssues: issues(
        filter: {
          title: { startsWith: $prefix }
          state: { type: { eq: "completed" } }
        }
        first: 1
      ) {
        pageInfo { hasNextPage }
        nodes { id }
      }

      # Completed cycles in the last 30 days (pick first with client issues in JS)
      lastCycle: cycles(
        filter: {
          endsAt: { gte: "${thirtyDaysAgo}", lte: "${now.toISOString()}" }
        }
        first: 20
      ) {
        nodes {
          name
          number
          startsAt
          endsAt
          completedIssues: issues(
            filter: {
              project: { name: { startsWith: $prefix } }
              state: { type: { eq: "completed" } }
            }
            first: 100
          ) {
            nodes {
              id
              title
              labels { nodes { name } }
              project { name }
            }
          }
          totalIssues: issues(
            filter: {
              project: { name: { startsWith: $prefix } }
            }
            first: 100
          ) {
            nodes { id }
          }
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
        variables: { prefix },
      }),
    });

    const json = await response.json();

    if (json.errors) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Linear API error", details: json.errors }),
      };
    }

    const d = json.data;
    console.log(JSON.stringify(d.lastCycle?.nodes?.[0]?.completedIssues?.nodes?.slice(0, 3), null, 2));

    // Strip [PREFIX] from titles for client-facing display
    const clean = (title) => title.replace(/^\[(?:MAK|LI|EVR)\]\s*/, "").trim();

    const firstDescriptionLine = (text) => {
      if (!text) return "";
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("##") || trimmed.startsWith("**")) {
          continue;
        }
        return trimmed.slice(0, 120);
      }
      return "";
    };

    // Map priority number to label
    const priorityMap = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" };

    // Map issue type from labels
    const getType = (labels) => {
      const names = labels.map((l) => l.name.toLowerCase());
      if (names.includes("bug")) return "fix";
      if (names.includes("feature")) return "feature";
      if (names.includes("improvement")) return "improvement";
      if (names.includes("integration")) return "integration";
      return "feature";
    };

    const mapIssue = (issue) => ({
      id: issue.id,
      title: clean(issue.title),
      description: firstDescriptionLine(issue.description),
      priority: priorityMap[issue.priority] || "medium",
      type: getType(issue.labels?.nodes || []),
      status: issue.state?.name || "",
      project: clean(issue.project?.name || ""),
      done: issue.state?.type === "completed",
    });

    const mapIdea = (issue) => ({
      id: issue.id,
      title: clean(issue.title),
      createdAt: issue.createdAt,
      status: issue.cycle ? "cycle" : "backlog",
      label: issue.labels?.nodes?.[0]?.name || "Feature",
    });

    const matchesClientProject = (i) => i.project?.name?.startsWith(prefix);

    // Dedupe: remove from Now any issues already in This Cycle
    const cycleIssuesFiltered = d.cycleIssues.nodes.filter(matchesClientProject);
    const cycleIds = new Set(cycleIssuesFiltered.map((i) => i.id));
    const nowFiltered = d.nowIssues.nodes
      .filter(matchesClientProject)
      .filter((i) => !cycleIds.has(i.id));

    // Map last cycle: most recent ended cycle in last 30 days with client issues
    const lastCycleNode = (d.lastCycle?.nodes || [])
      .sort((a, b) => new Date(b.endsAt) - new Date(a.endsAt))
      .find((cycle) => (cycle.totalIssues?.nodes || []).length > 0);

    const completedNodes = lastCycleNode?.completedIssues?.nodes || [];
    const totalNodes = lastCycleNode?.totalIssues?.nodes || [];
    const completedCount = completedNodes.length;
    const totalCount = totalNodes.length;
    const percentage =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const sortIdeasByCreatedDesc = (nodes) =>
      [...nodes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const lastCycleData = lastCycleNode ? [{
      name: lastCycleNode.name,
      number: lastCycleNode.number,
      startsAt: lastCycleNode.startsAt,
      endsAt: lastCycleNode.endsAt,
      completedCount,
      totalCount,
      percentage,
      issues: { nodes: completedNodes },
    }] : [];

    const result = {
      cycle: cycleIssuesFiltered.map(mapIssue),
      now: nowFiltered.map(mapIssue),
      ideas: {
        week: sortIdeasByCreatedDesc(d.ideaIssuesWeek.nodes).map(mapIdea),
        month: sortIdeasByCreatedDesc(d.ideaIssuesMonth.nodes).map(mapIdea),
      },
      stats: {
        inCycle: cycleIssuesFiltered.length,
        inProgress: nowFiltered.length,
        ideasThisMonth: d.ideaIssuesMonth.nodes.length,
      },
      lastCycle: lastCycleData,
      lastSynced: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Fetch failed", details: err.message }),
    };
  }
};

module.exports = { handler };
