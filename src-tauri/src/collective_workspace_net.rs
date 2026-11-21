//! Явний обмін колективного файлового середовища з сервером, адресу якого ввів користувач.
//! Вікно webview сюди не ходить: CSP лишається без нових хостів. Дозволені лише HTTPS
//! (без облікових даних у адресі, без шляху, без перенаправлень) і loopback HTTP для
//! локальної перевірки `wrangler dev`.

use serde_json::{json, Value};

const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const MAX_RESPONSE: usize = 2 * 1024 * 1024;
const MAX_REQUEST: usize = 512 * 1024;

#[derive(Debug)]
struct Endpoint {
    base: reqwest::Url,
}

fn endpoint(raw: &str) -> Result<Endpoint, String> {
    let raw = raw.trim();
    let url = reqwest::Url::parse(raw).map_err(|_| "адреса сервера некоректна".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("в адресі сервера не має бути пароля".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("адреса сервера має бути без параметрів і без шляху".into());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("адреса сервера має бути без шляху: застосунок сам додає /v1".into());
    }
    match url.scheme() {
        "https" => {}
        "http" if is_loopback(url.host_str().unwrap_or("")) => {}
        "http" => return Err("поза цим комп’ютером дозволено лише https".into()),
        _ => return Err("дозволено лише https".into()),
    }
    if url.host_str().is_none() {
        return Err("в адресі сервера немає імені".into());
    }
    Ok(Endpoint { base: url })
}

fn is_loopback(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']);
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

fn collective_id(body: &Value) -> Result<String, String> {
    let id = body
        .get("collectiveId")
        .and_then(Value::as_str)
        .unwrap_or("");
    if id.len() == 33
        && id.starts_with('c')
        && id.bytes().skip(1).all(|byte| byte.is_ascii_hexdigit())
    {
        Ok(id.to_string())
    } else {
        Err("немає ідентифікатора колективу".into())
    }
}

fn route(operation: &str, body: &Value) -> Result<String, String> {
    match operation {
        "create" => Ok("/v1/collectives".to_string()),
        "join" => Ok("/v1/join".to_string()),
        "invite" => Ok(format!("/v1/collectives/{}/invites", collective_id(body)?)),
        "role" => Ok(format!("/v1/collectives/{}/roles", collective_id(body)?)),
        "remove" => Ok(format!("/v1/collectives/{}/remove", collective_id(body)?)),
        "file" => Ok(format!("/v1/collectives/{}/files", collective_id(body)?)),
        "sync" => Ok(format!("/v1/collectives/{}/sync", collective_id(body)?)),
        _ => Err("невідома дія обміну".into()),
    }
}

/// Надсилає одну дію на сервер колективу. `token` іде лише в заголовок Authorization.
pub async fn exchange(
    url: String,
    operation: String,
    token: Option<String>,
    body: Option<Value>,
) -> Result<Value, String> {
    let endpoint = endpoint(&url)?;
    let payload = body.unwrap_or_else(|| json!({}));
    let path = route(operation.trim(), &payload)?;
    let mut target = endpoint.base.clone();
    target.set_path(&path);
    let bytes = serde_json::to_vec(&payload).map_err(|_| "не вдалося зібрати запит".to_string())?;
    if bytes.len() > MAX_REQUEST {
        return Err("запит до сервера завеликий".into());
    }
    crate::install_tls_provider();
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent("EasyWAR")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "не вдалося підготувати з’єднання".to_string())?;
    let mut request = client
        .post(target)
        .header(reqwest::header::ACCEPT, "application/json")
        .body(bytes);
    if let Some(token) = token.filter(|value| !value.is_empty()) {
        if !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("жетон сеансу пошкоджено".into());
        }
        request = request.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "сервер колективу не відповів вчасно".to_string()
        } else {
            "немає зв’язку із сервером колективу".to_string()
        }
    })?;
    if response.content_length().unwrap_or(0) > MAX_RESPONSE as u64 {
        return Err("відповідь сервера завелика".into());
    }
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "відповідь сервера обірвалася".to_string())?;
    if bytes.len() > MAX_RESPONSE {
        return Err("відповідь сервера завелика".into());
    }
    let mut value: Value = serde_json::from_slice(&bytes).unwrap_or_else(
        |_| json!({ "ok": false, "error": format!("сервер відповів кодом {}", status.as_u16()) }),
    );
    if !status.is_success() && value.get("ok").and_then(Value::as_bool) != Some(false) {
        value["ok"] = Value::Bool(false);
        if value.get("error").is_none() {
            value["error"] = Value::String(format!("сервер відповів кодом {}", status.as_u16()));
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_or_loopback_http_and_no_path() {
        assert!(endpoint("https://collective.example").is_ok());
        assert!(endpoint("http://127.0.0.1:8787").is_ok());
        assert!(endpoint("http://localhost:8787/").is_ok());
        assert!(endpoint("http://[::1]:8787").is_ok());
        assert!(endpoint("http://192.168.0.10").is_err());
        assert!(endpoint("https://user:secret@collective.example").is_err());
        assert!(endpoint("https://collective.example/v1").is_err());
        assert!(endpoint("https://collective.example?x=1").is_err());
        assert!(endpoint("ftp://collective.example").is_err());
    }

    #[test]
    fn routes_stay_under_v1_and_need_a_collective_id() {
        let id = "c".to_string() + &"ab".repeat(16);
        let body = json!({ "collectiveId": id, "fileOp": "create" });
        assert_eq!(route("create", &json!({})).unwrap(), "/v1/collectives");
        assert_eq!(route("join", &json!({})).unwrap(), "/v1/join");
        assert_eq!(
            route("file", &body).unwrap(),
            format!("/v1/collectives/{id}/files")
        );
        assert!(route("file", &json!({})).is_err());
        assert!(route("drop", &body).is_err());
    }
}
