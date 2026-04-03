use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;

static PROCESSED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

#[derive(Debug, Deserialize, Serialize)]
pub struct PrintJob {
    pub id: String,
    pub token: i32,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "fileUrl")]
    pub file_url: String,
    #[serde(rename = "pageCount")]
    pub page_count: i32,
    pub color: bool,
    pub copies: i32,
    #[serde(rename = "doubleSided")]
    pub double_sided: bool,
    #[serde(rename = "paperSize")]
    pub paper_size: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct JobsResponse {
    pub jobs: Vec<PrintJob>,
}

pub async fn poll_jobs(api_url: &str, agent_key: &str) -> Result<Vec<PrintJob>, String> {
    let client = Client::new();
    let url = format!("{}/api/jobs?status=queued", api_url);

    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", agent_key))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API error: {}", res.status()));
    }

    let data: JobsResponse = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

    // Filter already processed
    let mut set = PROCESSED.lock().unwrap();
    let processed = set.get_or_insert_with(HashSet::new);

    let new_jobs: Vec<PrintJob> = data
        .jobs
        .into_iter()
        .filter(|j| !processed.contains(&j.id))
        .collect();

    for job in &new_jobs {
        processed.insert(job.id.clone());
    }

    Ok(new_jobs)
}

pub async fn update_status(
    api_url: &str,
    agent_key: &str,
    job_id: &str,
    status: &str,
) -> Result<(), String> {
    let client = Client::new();
    let url = format!("{}/api/jobs/{}/status", api_url, job_id);

    let res = client
        .patch(&url)
        .header("Authorization", format!("Bearer {}", agent_key))
        .header("Content-Type", "application/json")
        .body(format!(r#"{{"status":"{}"}}"#, status))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API error: {}", res.status()));
    }

    Ok(())
}
