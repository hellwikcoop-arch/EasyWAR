-- Index for the exact-payload lookup that links a new XLSX row to the first
-- earlier row with the same parsed payload (repository::find_prior_xlsx_duplicate).
-- Without it every imported row scanned all parsed versions, so an import got
-- quadratically slower as the database grew. The index is partial: it covers
-- only first versions written by the XLSX parser, exactly the rows that lookup
-- compares. It adds no data and changes no rows.
CREATE INDEX idx_parsed_versions_xlsx_payload
ON parsed_report_versions(parsed_payload_json)
WHERE version = 1 AND parser_name = 'easywar-xlsx';
