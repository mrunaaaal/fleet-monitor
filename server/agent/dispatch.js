// Tool dispatch (fleet-monitor-docs.md §7.1): each tool is { name,
// description, input_schema, handler }, a thin wrapper over query/ plus a
// formatter. The investigation loop (#14) calls invoke() by name; list()
// is what actually gets sent to the model, so it must never leak a handler.
export function createToolDispatch({ tools }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  function list() {
    return tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  }

  async function invoke(name, input) {
    const tool = byName.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    return tool.handler(input ?? {});
  }

  return { list, invoke };
}
