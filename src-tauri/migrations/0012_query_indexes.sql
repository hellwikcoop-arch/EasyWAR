PRAGMA foreign_keys = ON;

-- Пошук раніше імпортованого рядка з тим самим розібраним вмістом
-- (find_prior_xlsx_duplicate) виконується для кожного рядка XLSX. Без цього
-- індексу він читав усю parsed_report_versions, і час імпорту зростав
-- квадратично. Частковий індекс охоплює лише версії XLSX-розбору.
CREATE INDEX idx_parsed_versions_xlsx_payload
ON parsed_report_versions(parsed_payload_json)
WHERE version = 1 AND parser_name = 'easywar-xlsx';

-- Вхідні Signal і черга команд фільтрують джерела за типом і сортують за
-- часом захоплення; без індексу перебиралися всі доповіді, зокрема XLSX.
CREATE INDEX idx_raw_sources_type_captured
ON raw_sources(source_type, captured_at);
