/**
 * How many rows a list shows per page. A list that is a page of its own -- one of the entries
 * in the navigation -- has the room for 20; a list that shares its page with a header and
 * other tabs shows 10, so the page does not turn into a scroll past the header.
 */
export const PAGE_SIZE = {
    page: 20,
    embedded: 10,
} as const;

/** The pagination every list uses; only the size differs. */
export const pagination = (pageSize: number) => ({
    defaultValue: { pageSize },
    hideOnSinglePage: true,
});
