#!/usr/bin/env python3
"""提交旅游混剪模板任务并轮询结果。

接口文档：
- submit_agent_task: https://docs.vectcut.com/484014992e0
- task_status: https://docs.vectcut.com/484060034e0

运行方式：
    export VECTCUT_API_KEY="你的 token"
    python3 main.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SUBMIT_URL = "https://open.vectcut.com/cut_jianying/agent/submit_agent_task"
STATUS_URL = "https://open.vectcut.com/cut_jianying/agent/task_status"
POLL_INTERVAL_SECONDS = 1.5
POLL_TIMEOUT_SECONDS = 20 * 60

DEFAULT_PAYLOAD = {
    "agent_id": "hunjian_7c2e9f4a1b8d4c6f9a0e3d5b2f718c94",
    "params": {
        "mix_mode": "narration_mix",
        "kongjing_urls": [
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/1.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/2.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/3.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/4.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/5.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/6.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/7.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/8.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/9.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/10.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/11.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/12.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/13.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/14.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/15.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/16.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/17.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/18.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/19.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/20.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/21.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/22.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/23.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/24.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/25.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/26.mp4",
            "https://player.install-ai-guider.top/example/hunjian/chaoshan/27.mp4",
        ],
        "text_contents": [
            {
                "text": "潮汕什么时候最好玩？当然是现在！收藏好这份攻略，人均八百玩转五天四晚！今天带的是李哥一家三口，他们是刷到视频直接私信来的。我安排的行程不赶不累，吃住全包，景点全打卡。来看看我们怎么玩的。第一站，菩提禅寺，潮汕版布达拉宫，门票停车全免费。第二站，南澳跨海大桥，海上巨龙，一眼望不到头。第三站，长山尾灯塔。新人扎堆拍婚纱的高颜值打卡地。第四站自然之门，全国唯一海岛北回归线标志塔。第五站青澳湾，2400米金色沙滩。踩上去软的像彩云。如果你也想来潮汕，评论区扣攻略，我发你详细行程。",
                "provider": "volc",
                "voice_id": "gv_989402eaac7b421ca713864f2da2aeb8",
            }
        ],
        "subtitle_templates": ["asr_1f9c8d7e6a2b4c0d9e8f123456789abc"],
    },
}


class ApiError(RuntimeError):
    """包装接口失败信息，方便直接打印结构化错误。"""


def parse_error_payload(error: Exception) -> dict[str, Any]:
    message = str(error)
    try:
        parsed = json.loads(message)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return {"message": message}


def emit_payload(
    *,
    ok: bool,
    phase: str,
    submit_result: dict[str, Any] | None = None,
    status_result: dict[str, Any] | None = None,
    task_id: str = "",
    error: dict[str, Any] | None = None,
    stream: Any = sys.stdout,
) -> None:
    payload = {
        "ok": ok,
        "phase": phase,
        "task_id": str(task_id or "").strip(),
        "submit_result": submit_result or None,
        "status_result": status_result or None,
        "error": error or None,
    }
    print(json.dumps(payload, ensure_ascii=False), file=stream)


def request_json(
    url: str,
    token: str,
    *,
    method: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request_data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=request_data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method=method,
    )

    try:
        with urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise ApiError(
            json.dumps(
                {
                    "phase": "http_error",
                    "url": url,
                    "http_status": error.code,
                    "response": body,
                },
                ensure_ascii=False,
                indent=2,
            )
        ) from error
    except URLError as error:
        raise ApiError(
            json.dumps(
                {
                    "phase": "network_error",
                    "url": url,
                    "reason": str(error.reason),
                },
                ensure_ascii=False,
                indent=2,
            )
        ) from error

    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise ApiError(
            json.dumps(
                {
                    "phase": "invalid_json",
                    "url": url,
                    "response": raw,
                },
                ensure_ascii=False,
                indent=2,
            )
        ) from error


def submit_task(token: str, payload: dict[str, Any]) -> dict[str, Any]:
    result = request_json(SUBMIT_URL, token, method="POST", payload=payload)
    task_id = str(result.get("task_id") or "").strip()
    if not task_id:
        raise ApiError(
            json.dumps(
                {
                    "phase": "submit",
                    "url": SUBMIT_URL,
                    "response": result,
                    "message": "返回里缺少 task_id",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    return result


def poll_status(token: str, task_id: str) -> dict[str, Any]:
    deadline = time.time() + POLL_TIMEOUT_SECONDS
    last_result: dict[str, Any] | None = None

    while time.time() < deadline:
        url = f"{STATUS_URL}?{urlencode({'task_id': task_id})}"
        result = request_json(url, token, method="GET")
        last_result = result
        status = str(result.get("status") or "").strip().lower()

        if status == "success":
            return result
        if status == "failed":
            raise ApiError(
                json.dumps(
                    {
                        "phase": "poll",
                        "url": STATUS_URL,
                        "task_id": task_id,
                        "response": result,
                        "message": str(result.get("message") or result.get("error") or "任务执行失败"),
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )

        time.sleep(POLL_INTERVAL_SECONDS)

    raise ApiError(
        json.dumps(
            {
                "phase": "poll_timeout",
                "url": STATUS_URL,
                "task_id": task_id,
                "response": last_result,
                "message": "轮询超时，超过 20 分钟仍未完成",
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def main() -> int:
    token = os.getenv("VECTCUT_API_KEY", "").strip()
    if not token:
        emit_payload(
            ok=False,
            phase="bootstrap",
            error={"message": "缺少环境变量 VECTCUT_API_KEY"},
            stream=sys.stderr,
        )
        return 1

    submit_result: dict[str, Any] | None = None
    status_result: dict[str, Any] | None = None
    task_id = ""

    try:
        submit_result = submit_task(token, DEFAULT_PAYLOAD)
        task_id = str(submit_result.get("task_id") or "").strip()
        status_result = poll_status(token, task_id)
        emit_payload(
            ok=True,
            phase="completed",
            submit_result=submit_result,
            status_result=status_result,
            task_id=task_id,
        )
        return 0
    except Exception as error:
        emit_payload(
            ok=False,
            phase="error",
            submit_result=submit_result,
            status_result=status_result,
            task_id=task_id,
            error=parse_error_payload(error),
            stream=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
