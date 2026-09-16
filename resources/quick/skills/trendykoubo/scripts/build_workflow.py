#!/usr/bin/env python3
"""
build_workflow.py — 根据 semantic_plan.json + timeline.json 自动生成 workflow JSON
优化点：替代 LLM 推理组装工作流，从 ~95s 降至 <1s

用法:
  python3 build_workflow.py \
    --plan semantic_plan.json \
    --timeline timeline.json \
    --video-url "VIDEO_URL" \
    --bgm-url "BGM_URL" \
    [--output workflow.json] \
    [--seed 42]
"""
import json, sys, argparse, random

# ─── BGM 候选列表（workflow.md 官方列表）───
BGM_LIST = [
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/void.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/time_to_pretend.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/the_right_path.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/spoons_for_loons.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/night_cruising.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Monsieur_melody.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/melody_mix.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/IV_feat.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Golden_hour.MP3",
    "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Fight.MP3",
]

# ─── 语气预设 ID（style_config.md）───
TONE_PRESETS = {
    "result": "47bc790d-a58c-4eea-8d86-0852d8967664",
    "emphasis": "5a0b0550-6cd9-4e1e-928c-c52ee7657904",
}

# ─── 样式常量（style_config.md）───
VIDEO_PADDING = 0.3  # 主视频比文字前后各多 0.3s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--video-url", required=True)
    ap.add_argument("--bgm-url", default=None)
    ap.add_argument("--output", default="workflow.json")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    with open(args.plan) as f:
        plan = json.load(f)
    with open(args.timeline) as f:
        tl = json.load(f)

    random.seed(args.seed)

    video_url = args.video_url
    bgm_url = args.bgm_url or random.choice(BGM_LIST)
    duration = plan["timeline_duration"]
    items = plan["subtitle_items"]

    # ─── 顶层字段完整性检查：缺失时警告，防止标题/提示音/缩放静默丢失 ───
    import sys
    for _k, _desc in (("title", "双行标题"), ("zoom", "缩放关键帧"),
                      ("tone_presets", "提示音")):
        if not plan.get(_k):
            print(f"[WARN] semantic_plan 缺少顶层字段 {_k}（{_desc}不会生成）",
                  file=sys.stderr)

    # ─── 防重叠：按时间排序后裁剪相邻字幕的 end ───
    # 注意：词级对齐后条目序 ≠ 时间序（LLM 会重排句内语序），必须按时间排序裁剪，
    # 否则重排条目会把后一条的 end 裁到自己的 start 之前，导致整条被 e<=s 跳过
    order = sorted(range(len(items)), key=lambda i: items[i]["start"])
    for a, b in zip(order, order[1:]):
        if items[a]["end"] > items[b]["start"]:
            items[a]["end"] = items[b]["start"]
    for it in items:
        if it.get("keyword_pop_start") is not None:
            if it["keyword_pop_start"] >= it["end"]:
                it["keyword_pop_start"] = it["start"]
            if it["keyword_pop_end"] > it["end"]:
                it["keyword_pop_end"] = it["end"]

    script = []
    idx = [0]  # 用 list 以便闭包修改

    def add(action_type, params):
        idx[0] += 1
        script.append({
            "type": "action",
            "id": f"step_{idx[0]:03d}",
            "index": idx[0],
            "action_type": action_type,
            "params": params,
        })

    # ════════════════════════════════════════
    # 1. 视频片段（video_main, volume=20, relative_index=1）
    # ════════════════════════════════════════
    # 转场映射：plan.transitions 的 seg_index → 转场类型（仅 add_video 支持 transition）
    # 规则：每种最多一次、总数 ≤3（validate_plan 第 5 项拦截），duration 固定 0.6s 与重叠一致
    tr_by_seg = {}
    for tr in plan.get("transitions", []):
        si = tr.get("seg_index")
        t = tr.get("type", "")
        if si is not None and t:
            tr_by_seg[si] = (t, tr.get("duration", 0.6))

    for seg_i, seg in enumerate(tl["segments"]):
        src_s = seg["source_video"]["start"]
        src_e = seg["source_video"]["end"]
        tgt_s = seg["target_timeline"]["start"]
        # 使用精确源边界：禁止 ±VIDEO_PADDING 扩展，
        # 否则相邻段源时间重叠，add_video 报
        # "New segment overlaps with existing segment"
        v_p = {
            "video_url": video_url,
            "start": src_s,
            "end": src_e,
            "target_start": tgt_s,
            "track_name": "video_main",
            "volume": 20,
            "relative_index": 1,
        }
        if seg_i in tr_by_seg:
            t_name, t_dur = tr_by_seg[seg_i]
            v_p["transition"] = t_name
            v_p["transition_duration"] = t_dur
        add("add_video", v_p)

    # ════════════════════════════════════════
    # 2. 标题（0.0 ~ min(5.0, duration)）
    # ════════════════════════════════════════
    # ─── 标题字数硬限制：双行标题每行 ≤8 字（validate_plan 第 1 项兜底，此处双保险） ───
    for _k in ("top_title", "bottom_title"):
        _t = plan.get("title", {}).get(_k, "")
        if len(_t) > 8:
            print(f"[WARN] title.{_k}='{_t}' 长度 {len(_t)} > 8"
                  f"（双行标题每行严格 ≤8 字），请截断/改写后重跑校验",
                  file=sys.stderr)

    title_end = min(5.0, duration)
    title = plan.get("title", {})
    if title.get("top_title"):
        add("add_text", {
            "text": title["top_title"],
            "start": 0.0, "end": title_end,
            "font": "优设标题黑", "font_size": 15, "font_color": "#ffffff",
            "border_color": "#a81c23", "border_width": 20,
            "shadow_enabled": False, "fixed_width": 0.55, "align": 2,
            "transform_y_px": 1340,
            "track_name": "text_title_top", "relative_index": 10091,
        })
    if title.get("bottom_title"):
        add("add_text", {
            "text": title["bottom_title"],
            "start": 0.0, "end": title_end,
            "font": "思源粗宋", "font_size": 16, "font_color": "#a81c23",
            "border_color": "#ffffff", "border_width": 20,
            "shadow_enabled": False, "fixed_width": 0.55, "align": 2,
            "transform_y_px": 1117,
            "track_name": "text_title_bottom", "relative_index": 10092,
        })

    # ════════════════════════════════════════
    # 3. 字幕（普通/分层 + 英文 + 关键词弹出）
    # ════════════════════════════════════════
    for it in items:
        is_layered = it.get("layered", False)
        has_typewriter = random.random() < 0.5
        # 挖空⇔弹出必须成对：有 keyword_pop_text 就必须创建弹出层
        # 不能依赖 has_typewriter，否则随机到无打字机时关键词会丢失
        has_pop = (it.get("keyword_pop_text") is not None
                   and it["keyword_pop_text"] != "")
        s, e = it["start"], it["end"]
        if e <= s:
            continue

        if is_layered:
            text = it["text"]
            mid = len(text) // 2

            # 分层字幕的 display_text 拆分
            full_display = it.get("display_text", text)
            top_display = full_display[:mid] if has_pop else text[:mid]
            bottom_display = full_display[mid:] if has_pop else text[mid:]

            # 上行中文
            top_p = {
                "text": top_display, "start": s, "end": e,
                "font": "思源粗宋", "font_size": 15, "font_color": "#ffffff",
                "font_alpha": 0.95, "border_color": "#000000", "border_width": 1.8,
                "shadow_enabled": True,
                "transform_x_px": 394, "transform_y_px": -468,
                "align": 0, "fixed_width": 0.78,
                "track_name": "yimei_layered_top", "relative_index": 10030,
                "letter_spacing": it.get("top_display_letter_spacing", 0),
            }
            if has_typewriter:
                top_p["intro_animation"] = "打字机_I"
                top_p["intro_duration"] = 0.2
            add("add_text", top_p)

            # 下行中文
            bot_p = {
                "text": bottom_display, "start": s, "end": e,
                "font": "思源粗宋", "font_size": 15, "font_color": "#ffffff",
                "font_alpha": 0.95, "border_color": "#000000", "border_width": 1.8,
                "shadow_enabled": True,
                "transform_x_px": -573, "transform_y_px": -931,
                "align": 2, "fixed_width": 0.86,
                "track_name": "yimei_layered_bottom", "relative_index": 10032,
                "letter_spacing": it.get("bottom_display_letter_spacing", 0),
            }
            add("add_text", bot_p)

            # 上行英文
            add("add_text", {
                "text": it.get("en") or it.get("translation") or "", "start": s, "end": e,
                "font": "Poppins_Bold", "font_size": 6.5, "font_color": "#ffffff",
                "font_alpha": 0.95, "border_color": "#222222", "border_width": 0.8,
                "shadow_enabled": True,
                "transform_x_px": 394, "transform_y_px": -635,
                "align": 0, "fixed_width": 0.78,
                "track_name": "yimei_layered_top_en", "relative_index": 10031,
            })

            # 下行英文
            add("add_text", {
                "text": (it.get("en_bottom") or it.get("en")
                         or it.get("translation") or ""),
                "start": s, "end": e,
                "font": "Poppins_Bold", "font_size": 6.5, "font_color": "#ffffff",
                "font_alpha": 0.95, "border_color": "#222222", "border_width": 0.8,
                "shadow_enabled": True,
                "transform_x_px": -573, "transform_y_px": -1100,
                "align": 2, "fixed_width": 0.82,
                "track_name": "yimei_layered_bottom_en", "relative_index": 10033,
            })

            # 关键词弹出层
            if has_pop:
                kw = it.get("keyword", "")
                kpos = text.find(kw) if kw else -1
                if kpos >= 0:
                    if kpos < mid:
                        # 关键词在上行
                        top_pop = "\u3000" * kpos + kw + "\u3000" * (mid - kpos - len(kw))
                        add("add_text", {
                            "text": top_pop,
                            "start": it["keyword_pop_start"], "end": it["keyword_pop_end"],
                            "font": "思源粗宋", "font_size": 15, "font_color": "#A81C23",
                            "shadow_enabled": True, "shadow_color": "#ffffff",
                            "intro_animation": "左移弹动", "intro_duration": 0.16,
                            "transform_x_px": 394, "transform_y_px": -468,
                            "align": 0, "fixed_width": 0.78,
                            "track_name": "yimei_layered_top_keyword_pop",
                            "relative_index": 10034,
                            "letter_spacing": it.get("top_keyword_pop_letter_spacing", 0),
                        })
                    else:
                        # 关键词在下行
                        bkpos = kpos - mid
                        bottom_text = text[mid:]
                        bottom_pop = "\u3000" * bkpos + kw + "\u3000" * (len(bottom_text) - bkpos - len(kw))
                        add("add_text", {
                            "text": bottom_pop,
                            "start": it["keyword_pop_start"], "end": it["keyword_pop_end"],
                            "font": "思源粗宋", "font_size": 15, "font_color": "#A81C23",
                            "shadow_enabled": True, "shadow_color": "#ffffff",
                            "intro_animation": "左移弹动", "intro_duration": 0.25,
                            "transform_x_px": -573, "transform_y_px": -931,
                            "align": 2, "fixed_width": 0.86,
                            "track_name": "yimei_layered_bottom_keyword_pop",
                            "relative_index": 10035,
                            "letter_spacing": it.get("bottom_keyword_pop_letter_spacing", 0),
                        })
        else:
            # ─── 普通单行字幕 ───
            cn_p = {
                "text": it.get("display_text", it["text"]),
                "start": s, "end": e,
                "font": "思源粗宋", "font_size": 15, "font_color": "#ffffff",
                "font_alpha": 0.95, "border_color": "#000000", "border_width": 1.3,
                "shadow_enabled": True, "transform_y_px": -526,
                "fixed_width": 0.82,
                "track_name": "yimei_normal_cn", "relative_index": 10020,
                "letter_spacing": it.get("normal_display_letter_spacing", 0),
            }
            if has_typewriter:
                cn_p["intro_animation"] = "打字机_I"
                cn_p["intro_duration"] = 0.2
            add("add_text", cn_p)

            # 英文
            add("add_text", {
                "text": it.get("en") or it.get("translation") or "", "start": s, "end": e,
                "font": "Poppins_Bold", "font_size": 6.5, "font_color": "#ffffff",
                "font_alpha": 0.95, "border_color": "#222222", "border_width": 0.8,
                "shadow_enabled": True, "transform_y_px": -700,
                "fixed_width": 0.82,
                "track_name": "yimei_normal_en", "relative_index": 10021,
            })

            # 关键词弹出
            if has_pop:
                add("add_text", {
                    "text": it["keyword_pop_text"],
                    "start": it["keyword_pop_start"], "end": it["keyword_pop_end"],
                    "font": "思源粗宋", "font_size": 15, "font_color": "#A81C23",
                    "shadow_enabled": True, "shadow_color": "#ffffff",
                    "intro_animation": "左移弹动", "intro_duration": 0.25,
                    "transform_y_px": -526, "fixed_width": 0.82,
                    "track_name": "yimei_normal_cn_keyword_pop",
                    "relative_index": 10022,
                    "letter_spacing": it.get("normal_keyword_pop_letter_spacing", 0),
                })

    # ════════════════════════════════════════
    # 4. 缩放关键帧（scale_x + scale_y 分开两步）
    # ════════════════════════════════════════
    zoom = plan.get("zoom")
    if zoom and zoom.get("trigger_sub_index") is not None:
        zi = zoom["trigger_sub_index"]
        if 0 <= zi < len(items):
            zoom_sub = items[zi]
            zs = zoom_sub["start"]
            ze = zoom_sub["end"]
            sc = str(zoom.get("scale", 1.2))
            times = [round(zs - 0.01, 2), zs, ze, round(ze + 0.01, 2)]
            add("add_video_keyframe", {
                "track_name": "video_main",
                "times": times,
                "property_types": ["scale_x"] * 4,
                "values": ["1", sc, sc, "1"],
            })
            add("add_video_keyframe", {
                "track_name": "video_main",
                "times": times,
                "property_types": ["scale_y"] * 4,
                "values": ["1", sc, sc, "1"],
            })

    # ════════════════════════════════════════
    # 5. 语气预设（提示音）
    # ════════════════════════════════════════
    used_presets = set()
    for tp in plan.get("tone_presets", []):
        pid = TONE_PRESETS.get(tp["tone_type"])
        if not pid or pid in used_presets:
            continue
        used_presets.add(pid)
        ti = tp.get("trigger_sub_index", 0)
        if 0 <= ti < len(items):
            add("add_preset", {
                "preset_id": pid,
                "target_start": items[ti]["start"],
                "track_name": f"preset_tone_{tp['tone_type']}",
            })

    # ════════════════════════════════════════
    # 6. BGM（循环铺满时间轴）
    # ════════════════════════════════════════
    add("add_audio", {
        "audio_url": bgm_url,
        "start": 0.0, "end": duration, "target_start": 0.0,
        "track_name": "audio_bgm", "volume": 3,
    })

    # ════════════════════════════════════════
    # 输出 workflow JSON
    # ════════════════════════════════════════
    workflow = {
        "inputs": {
            "video_path": video_url,
            "bgm_url": bgm_url,
            "timeline_duration": duration,
        },
        "script": script,
    }

    out = json.dumps(workflow, ensure_ascii=False)
    if args.output:
        with open(args.output, "w") as f:
            f.write(out)

    # 打印摘要到 stderr
    types = {}
    for s in script:
        t = s["action_type"]
        types[t] = types.get(t, 0) + 1
    print(f"✅ workflow 组装完成", file=sys.stderr)
    print(f"   脚本步骤: {len(script)}", file=sys.stderr)
    print(f"   时间轴: {duration}s", file=sys.stderr)
    for t, c in sorted(types.items()):
        print(f"   {t}: {c}", file=sys.stderr)


if __name__ == "__main__":
    main()
