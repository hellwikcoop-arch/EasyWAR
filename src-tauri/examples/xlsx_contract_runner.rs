use easywar_lib::xlsx_import::{import_easywar_xlsx, XlsxImportBatch};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    io::{self, Read},
    process::ExitCode,
};

const MAX_CASES: usize = 16;
const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
struct ContractRequest {
    cases: Vec<ContractCase>,
}

#[derive(Deserialize)]
struct ContractCase {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
struct ContractOutcome {
    name: String,
    batch: Option<XlsxImportBatch>,
    error: Option<String>,
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut input = Vec::new();
    io::stdin().read_to_end(&mut input)?;
    let request: ContractRequest = serde_json::from_slice(&input)?;
    if request.cases.len() > MAX_CASES {
        return Err(format!("too many XLSX contract cases: {}", request.cases.len()).into());
    }
    let total_bytes = request
        .cases
        .iter()
        .try_fold(0usize, |total, case| total.checked_add(case.bytes.len()))
        .ok_or("XLSX contract input size overflow")?;
    if total_bytes > MAX_TOTAL_BYTES {
        return Err(format!("XLSX contract input exceeds {MAX_TOTAL_BYTES} bytes").into());
    }

    let outcomes = request
        .cases
        .into_iter()
        .map(|case| match import_easywar_xlsx(&case.bytes) {
            Ok(batch) => ContractOutcome {
                name: case.name,
                batch: Some(batch),
                error: None,
            },
            Err(error) => ContractOutcome {
                name: case.name,
                batch: None,
                error: Some(error.to_string()),
            },
        })
        .collect::<Vec<_>>();
    serde_json::to_writer(io::stdout().lock(), &outcomes)?;
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("XLSX contract runner failed: {error}");
            ExitCode::FAILURE
        }
    }
}
