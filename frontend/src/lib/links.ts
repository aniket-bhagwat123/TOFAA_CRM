/** Where a deal lives: client projects in Projects, everything else in Leads. */
export const dealHref = (d: { id: string; pipeline?: string | null }) => (d.pipeline === "client" ? `/projects/${d.id}` : `/leads/${d.id}`);
