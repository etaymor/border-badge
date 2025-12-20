-- Migration: Add get_click_stats RPC function
-- Purpose: Database-level aggregation for click statistics to avoid loading
--          millions of rows into memory for high-traffic periods.

-- Function to get aggregated click statistics for a given time period
CREATE OR REPLACE FUNCTION get_click_stats(since_date timestamptz)
RETURNS JSON
LANGUAGE SQL
STABLE
AS $$
SELECT json_build_object(
    'total_clicks', COALESCE(COUNT(*), 0),
    'unique_links', COALESCE(COUNT(DISTINCT link_id), 0),
    'by_source', COALESCE(
        (SELECT json_object_agg(source, cnt)
         FROM (
             SELECT source, COUNT(*) as cnt
             FROM outbound_click
             WHERE clicked_at >= since_date
             GROUP BY source
         ) s),
        '{}'::json
    ),
    'by_resolution', COALESCE(
        (SELECT json_object_agg(resolution, cnt)
         FROM (
             SELECT resolution, COUNT(*) as cnt
             FROM outbound_click
             WHERE clicked_at >= since_date
             GROUP BY resolution
         ) r),
        '{}'::json
    ),
    'top_domains', COALESCE(
        (SELECT json_agg(row_to_json(d))
         FROM (
             SELECT
                 substring(destination_url from 'https?://([^/]+)') as domain,
                 COUNT(*) as clicks
             FROM outbound_click
             WHERE clicked_at >= since_date
               AND destination_url IS NOT NULL
             GROUP BY 1
             ORDER BY clicks DESC
             LIMIT 10
         ) d),
        '[]'::json
    )
)
FROM outbound_click
WHERE clicked_at >= since_date;
$$;

-- Grant execute permission to authenticated users (admin routes use service role)
GRANT EXECUTE ON FUNCTION get_click_stats(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION get_click_stats(timestamptz) TO service_role;

COMMENT ON FUNCTION get_click_stats IS 'Get aggregated click statistics since a given date. Returns total clicks, unique links, breakdowns by source and resolution, and top 10 destination domains.';
