# -*- coding: utf-8 -*-
from flask import Flask, render_template, request, jsonify
import requests
import os
import re

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static"
)

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "").strip()
YOUTUBE_REGION = os.getenv("YOUTUBE_REGION", "PT").strip().upper()
YOUTUBE_LANG = os.getenv("YOUTUBE_LANG", "pt").strip()
MAX_RESULTS = int(os.getenv("YOUTUBE_MAX_RESULTS", "30"))

YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"


def api_error(message, status_code=500):
    return jsonify({
        "ok": False,
        "error": message
    }), status_code


def youtube_get(url, params):
    try:
        response = requests.get(url, params=params, timeout=15)

        try:
            data = response.json()
        except Exception:
            return {
                "ok": False,
                "error": "A resposta da API do YouTube não veio em JSON válido."
            }

        if response.status_code != 200:
            error = data.get("error", {})
            message = error.get("message", "Erro desconhecido na API do YouTube.")

            return {
                "ok": False,
                "error": message,
                "details": data
            }

        return {
            "ok": True,
            "data": data
        }

    except requests.exceptions.Timeout:
        return {
            "ok": False,
            "error": "Timeout ao contactar a API do YouTube."
        }

    except requests.exceptions.RequestException as e:
        return {
            "ok": False,
            "error": f"Erro de ligação: {str(e)}"
        }

    except Exception as e:
        return {
            "ok": False,
            "error": str(e)
        }


def iso8601_to_seconds(duration):
    if not duration:
        return 0

    pattern = r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"
    match = re.match(pattern, duration)

    if not match:
        return 0

    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)

    return hours * 3600 + minutes * 60 + seconds


def format_duration(seconds):
    if not seconds:
        return ""

    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60

    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"

    return f"{minutes}:{secs:02d}"


def is_allowed_in_region(content_details, region_code):
    restrictions = content_details.get("regionRestriction", {})

    allowed = restrictions.get("allowed")
    blocked = restrictions.get("blocked")

    if allowed is not None:
        return region_code in allowed

    if blocked is not None:
        return region_code not in blocked

    return True


def clean_title(title):
    if not title:
        return "Sem título"

    return (
        title.replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )


def build_search_params(query, music_only=True):
    params = {
        "key": YOUTUBE_API_KEY,
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": min(MAX_RESULTS, 50),
        "videoEmbeddable": "true",
        "videoSyndicated": "true",
        "safeSearch": "none",
        "regionCode": YOUTUBE_REGION,
        "relevanceLanguage": YOUTUBE_LANG,
        "order": "relevance"
    }

    if music_only:
        params["videoCategoryId"] = "10"

    return params


def search_youtube(query, music_only=True):
    search_params = build_search_params(query, music_only)

    search_response = youtube_get(YOUTUBE_SEARCH_URL, search_params)

    if not search_response["ok"]:
        return search_response

    search_data = search_response["data"]

    video_ids = []
    seen = set()

    for item in search_data.get("items", []):
        video_id = item.get("id", {}).get("videoId")

        if video_id and video_id not in seen:
            seen.add(video_id)
            video_ids.append(video_id)

    if not video_ids:
        return {
            "ok": True,
            "results": []
        }

    videos_params = {
        "key": YOUTUBE_API_KEY,
        "part": "status,snippet,contentDetails",
        "id": ",".join(video_ids),
        "hl": YOUTUBE_LANG
    }

    videos_response = youtube_get(YOUTUBE_VIDEOS_URL, videos_params)

    if not videos_response["ok"]:
        return videos_response

    videos_data = videos_response["data"]

    results = []

    for item in videos_data.get("items", []):
        video_id = item.get("id")

        if not video_id:
            continue

        status = item.get("status", {})
        snippet = item.get("snippet", {})
        content_details = item.get("contentDetails", {})

        privacy_status = status.get("privacyStatus")
        embeddable = status.get("embeddable", False)

        if privacy_status != "public":
            continue

        if not embeddable:
            continue

        if not is_allowed_in_region(content_details, YOUTUBE_REGION):
            continue

        if snippet.get("liveBroadcastContent") in ["live", "upcoming"]:
            continue

        duration_iso = content_details.get("duration", "")
        duration_seconds = iso8601_to_seconds(duration_iso)

        if duration_seconds and duration_seconds < 35:
            continue

        thumbnails = snippet.get("thumbnails", {})

        thumb = (
            thumbnails.get("maxres") or
            thumbnails.get("standard") or
            thumbnails.get("high") or
            thumbnails.get("medium") or
            thumbnails.get("default") or
            {}
        ).get("url", "")

        title = clean_title(snippet.get("title", "Sem título"))
        channel = clean_title(snippet.get("channelTitle", "YouTube"))

        results.append({
            "video_id": video_id,
            "title": title,
            "channel": channel,
            "thumb": thumb,
            "duration": duration_iso,
            "duration_text": format_duration(duration_seconds),
            "duration_seconds": duration_seconds,
            "watch_url": f"https://www.youtube.com/watch?v={video_id}",
            "embed_url": f"https://www.youtube.com/embed/{video_id}"
        })

    return {
        "ok": True,
        "results": results
    }


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/health")
@app.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "app": "YouTube Super Deus",
        "youtube_key_ready": bool(YOUTUBE_API_KEY),
        "region": YOUTUBE_REGION,
        "language": YOUTUBE_LANG,
        "max_results": MAX_RESULTS
    })


@app.route("/search")
@app.route("/api/search")
def search():
    query = request.args.get("q", "").strip()
    music_only = request.args.get("music", "1").strip() == "1"

    if not query:
        return jsonify({
            "ok": True,
            "query": "",
            "region": YOUTUBE_REGION,
            "music_only": music_only,
            "total": 0,
            "results": []
        })

    if not YOUTUBE_API_KEY:
        return api_error("Falta configurar a variável de ambiente YOUTUBE_API_KEY.", 500)

    main_response = search_youtube(query, music_only=music_only)

    if not main_response["ok"]:
        return api_error(main_response["error"], 500)

    results = main_response.get("results", [])

    # Fallback automático:
    # Se estiver em modo música e vierem poucos resultados,
    # faz uma segunda pesquisa sem videoCategoryId=10.
    if music_only and len(results) < 5:
        fallback_response = search_youtube(query, music_only=False)

        if fallback_response["ok"]:
            fallback_results = fallback_response.get("results", [])
            seen = {item["video_id"] for item in results}

            for item in fallback_results:
                if item["video_id"] not in seen:
                    results.append(item)
                    seen.add(item["video_id"])

    return jsonify({
        "ok": True,
        "query": query,
        "region": YOUTUBE_REGION,
        "language": YOUTUBE_LANG,
        "music_only": music_only,
        "total": len(results),
        "results": results
    })


if __name__ == "__main__":
    print("")
    print("✨ YouTube Super Deus iniciado")
    print("🌐 Abre no browser:")
    print("   http://127.0.0.1:5000")
    print("")
    app.run(host="127.0.0.1", port=5000, debug=True)