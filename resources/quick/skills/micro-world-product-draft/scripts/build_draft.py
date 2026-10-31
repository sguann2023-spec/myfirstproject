#!/usr/bin/env python3
"""把 edit_plan.json 编译成「剪映草稿操作清单」。

这是 render.py 的草稿版对位品：render.py 把一切烧进像素，本脚本把一切落成
**可在剪映里继续编辑的元素**（轨道 / 片段 / 关键帧 / 文本层 / 音频层）。

设计原则
  1. 几何在 prep_clips.py 里消化（clip 的 source_start=0），创意全部留在草稿里
  2. 运镜 = uniform_scale 关键帧（不是 zoompan），可在剪映时间轴上直接拖
  3. 文字 = 文本层（字体/字号/描边/阴影/入场动画全部原生可改）
  4. <hl> 高亮词 = 独立「关键词」文本层（后端 text_styles 分段颜色不可用）
  5. 同类元素合并成 batch 调用，67 次请求压到 ~12 次

产物
  draft_ops.json   人类可读的操作清单（绝对路径）
  draft_exec.js    可直接粘进 VectCutClaw codemode 执行的脚本（相对路径 + B 前缀）

用法
  python3 scripts/prep_clips.py                     # 先出标准 clip
  python3 scripts/build_draft.py                    # 生成清单
  python3 scripts/build_draft.py --show             # 打印时间轴摘要
  python3 scripts/build_draft.py --draft dfd_xxx    # 把 draft_id 固化进 exec.js
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = json.load(open(os.path.join(ROOT, "edit_plan.json"), encoding="utf-8"))
CLIPS = os.path.join(ROOT, "assets", "clips", "manifest.json")

META, SHOTS = PLAN["meta"], PLAN["shots"]
W, H, TOTAL = META["width"], META["height"], META["total"]
D = PLAN["draft"]
F, C = D["fonts"], D["colors"]
TR = D["tracks"]
AUDIO = PLAN["audio"]
GT = PLAN.get("global_text", {})
E = "mcp__vectcut__draft-elements__"

manifest = json.load(open(CLIPS, encoding="utf-8")) if os.path.exists(CLIPS) else {}

# ---------------------------------------------------------------- 时间轴
timeline, t = [], 0.0
for s in SHOTS:
    timeline.append((round(t, 3), round(t + s["dur"], 3), s))
    t += s["dur"]
TOTAL = round(t, 2)


def local_path(p):
    """把配置里的素材路径统一解析为本地绝对路径。

    草稿工具虽接受本地文件，但路径必须是绝对路径；此前把 assets/... 原样写入
    draft_ops.json，服务端虽创建了片段，剪映客户端却无法解析素材，表现为空草稿。
    HTTP(S)/file URL 保持不变。
    """
    if not isinstance(p, str) or re.match(r"^(?:https?|file)://", p):
        return p
    return os.path.normpath(p if os.path.isabs(p) else os.path.join(ROOT, p))


# ---- 云渲染实测标定（见 剪辑逻辑.md「剪映字号/坐标标定」）------------------
#   字高 px = font_size 单位 x FS_H      字宽 px = 单位 x FS_W
#   屏幕中心 y = H/2 - transform_y_px / 2   （即 transform_*_px 的有效偏移只有一半）
FS_H, FS_W = 5.70, 6.08
TRANS_X2 = 2


def sw(outline_px, size_px):
    """目标描边像素 -> 剪映 border_width。
    实测 material.styles[].strokes[].width = border_width * 0.002，
    且该 width 是「相对字高的比例」，所以描边必须按字号归一。"""
    if not outline_px or not size_px:
        return 0
    return max(0, round(outline_px / size_px / 0.002))


def fs(px):
    """目标像素字号 -> 剪映 font_size 单位（edit_plan 里一律按像素写，可读）。"""
    return max(1, round(px / FS_H))


def ty(y_top_px, size_px, ratio=0.75):
    """PIL/ASS 顶边坐标 + 像素字号 -> 剪映 transform_y_px。"""
    center = y_top_px + size_px * ratio          # 目标屏幕中心
    return round(TRANS_X2 * ((H / 2) - center))


def hl_parse(s):
    if not s:
        return None, None
    m = re.search(r"<hl>(.*?)</hl>", s)
    if not m:
        return s, None
    return s.replace("<hl>", "").replace("</hl>", ""), m.group(1)


ops = []


def add(tool, args, note):
    # 所有媒体引用在写入操作清单前转成本地绝对路径；exec.js 再将工程根压成
    # @@/ 以便携带，执行时恢复成绝对路径。文字等普通字符串不处理。
    for key in ("video_url", "image_url", "audio_url"):
        if key in args:
            args[key] = local_path(args[key])
    for key in ("video_urls", "image_urls", "audio_urls"):
        if key in args:
            args[key] = [local_path(p) for p in args[key]]
    ops.append({"tool": E + tool, "args": args, "_note": note})


# ---------------------------------------------------------------- 1 画面层
vid = [x for x in timeline if x[2]["type"] == "video"]
batch_urls, batch_st, batch_en, batch_ts, batch_te = [], [], [], [], []
for ts, te, s in vid:
    m = manifest.get(s["id"])
    if not m:
        sys.exit(f"缺少 clip：{s['id']}，请先跑 scripts/prep_clips.py")
    # 源长度 = 时间轴时长 x 倍速；剪映里 speed 会把源拉长/压短到时间轴区间
    src_end = min(m["clip_dur"], round((te - ts) * m["speed"], 3))
    if m["speed"] != 1:                      # 变速段单独加，保证 speed 精确
        add("add_video", {
            "video_url": m["clip"], "start": 0, "end": src_end,
            "target_start": ts, "target_end": te, "speed": m["speed"],
            "track_name": TR["video"], "width": W, "height": H,
            "volume": -60,                      # clip 已 -an，这里再压死防止有残余声
        }, f"{s['id']} 画面 {m['speed']}x")
        continue
    batch_urls.append(m["clip"]); batch_st.append(0); batch_en.append(src_end)
    batch_ts.append(ts); batch_te.append(te)
add("add_batch_video", {
    "video_urls": batch_urls, "starts": batch_st, "ends": batch_en,
    "durations": batch_en[:], "target_starts": batch_ts, "target_ends": batch_te,
    "track_name": TR["video"], "width": W, "height": H, "volume": -60,
}, "主视频 8 段")

imgs = [(ts, te, s) for ts, te, s in timeline if s["type"] in ("image", "card")]
if imgs:
    add("add_batch_image", {
        "image_urls": [s["src"] for _, _, s in imgs],
        "starts": [ts for ts, _, _ in imgs],
        "ends": [te for _, te, _ in imgs],
        "track_name": TR["video"], "width": W, "height": H,
    }, "图片镜头（产品卡 / 结尾卡无字底图）")

# ---------------------------------------------------------------- 2 运镜关键帧
# clip 的 source_start=0 => time_offset = times - target_start，精确可控。
# 起始值必须 ≠ 1.0，否则后端把「无变化」的关键帧丢掉。
AMT = D["motion"]["amount"]
kf_prop, kf_time, kf_val = [], [], []
for ts, te, s in timeline:
    motion = s.get("motion", "none")
    if motion == "none" or (te - ts) < 0.8 or s["type"] in ("image", "card"):
        continue
    a, b = (1 - AMT, 1 + AMT) if motion == "push_in" else (1 + AMT, 1 - AMT)
    kf_prop += ["uniform_scale", "uniform_scale"]
    kf_time += [round(ts + 0.05, 3), round(te - 0.02, 3)]
    kf_val += [f"{a:.3f}", f"{b:.3f}"]
add("add_video_keyframe", {
    "track_name": TR["video"], "property_types": kf_prop,
    "times": kf_time, "values": kf_val,
}, f"运镜关键帧 {len(kf_time)//2} 段")

# ---------------------------------------------------------------- 3 文本层
SOLO_N = [0]


def text_group(track, items, font, size, color, stroke, ypos, anim, adur,
               extra=None, note="", solo=False):
    """items: [(text, start, end)] —— 同一样式一次 batch 提交。

    solo=True 时每条各占一条轨道：剪映里同一文字轨不允许片段时间重叠，
    而结尾卡 / 常驻标注这类「同屏多层」必须分轨。
    """
    if not items:
        return
    if solo:
        for it in items:
            SOLO_N[0] += 1
            text_group(f"{track}·{SOLO_N[0]}", [it], font, size, color, stroke,
                       ypos, anim, adur, extra, f"{note}{SOLO_N[0]}", solo=False)
        return
    args = {
        "texts": [i[0] for i in items], "starts": [i[1] for i in items],
        "ends": [i[2] for i in items], "track_name": track, "font": font,
        "font_size": fs(size), "font_color": color,
        "border_width": sw(stroke, size),
        "border_color": C["outline"], "transform_y_px": ypos, "align": 1,
        "width": W, "height": H,
    }
    # 所有主要文字层显式写入阴影；不能只给主字幕加阴影。
    args.update(D.get("text_defaults", {
        "border_alpha": 1.0, "shadow_enabled": True,
        "shadow_alpha": 0.65, "shadow_distance": 6,
        "shadow_angle": 45, "shadow_color": "#000000",
        "shadow_smoothing": 0.15,
    }))
    if anim:
        args["intro_animation"] = anim
        args["intro_duration"] = adur
    if extra:
        args.update(extra)
    add("add_batch_text", args, note or f"{track} {len(items)}条")


subs, kws, keys, keysubs = [], [], [], []
for ts, te, s in timeline:
    if s.get("key"):
        keys.append((s["key"], round(ts + 0.12, 3), round(te - 0.06, 3)))
        if s.get("keysub"):
            keysubs.append((s["keysub"], round(ts + 0.26, 3), round(te - 0.06, 3)))
        continue
    full, kw = hl_parse(s.get("sub") or "")
    if not full:
        continue
    # split（默认）：主字幕只放「剩余文本」，<hl> 词交给上层关键词花字，
    #   两层拼起来正好是一句话，避免同一词在屏幕上出现两遍。
    # whole：主字幕放整句，不出关键词层（用于拆开会读不通的句子）。
    if kw and s.get("sub_mode", "split") == "split":
        rest = full.replace(kw, "", 1)
        if rest.strip("，。！？ ·"):
            subs.append((rest.strip(), round(ts + 0.10, 3), round(te - 0.06, 3)))
        kws.append((kw, round(ts + 0.24, 3), round(te - 0.06, 3)))
    else:
        subs.append((full, round(ts + 0.10, 3), round(te - 0.06, 3)))

text_group(TR["sub"], subs, F["sub"], D["size"]["sub"], C["white"],
           D["stroke"]["sub"], ty(D["pos"]["sub"], D["size"]["sub"]),
           D["anim"]["sub_in"], 0.25,
           {"shadow_enabled": True, "shadow_alpha": 0.6, "shadow_distance": 6,
            "shadow_angle": 45, "shadow_color": "#000000"}, "主字幕")
text_group(TR["keyword"], kws, F["keyword"], D["size"]["keyword"], C["yellow"],
           D["stroke"]["keyword"], ty(D["pos"]["keyword"], D["size"]["keyword"]),
           D["anim"]["keyword_in"], 0.32, None, "关键词花字")
text_group(TR["key"], keys, F["key"], D["size"]["key"], C["yellow"],
           D["stroke"]["key"], ty(D["pos"]["key"], D["size"]["key"]),
           D["anim"]["keyword_in"], 0.32, None, "成分大字")
text_group(TR["keysub"], keysubs, F["keysub"], D["size"]["keysub"], C["mint"], 2,
           ty(D["pos"]["keysub"], D["size"]["keysub"]), "渐显", 0.22,
           {"background_style": 1, "background_color": C["panel"],
            "background_alpha": 0.86, "background_round_radius": 0.12,
            "background_width": 1.12, "background_height": 1.18},
           "成分副标（色块底板）")

# 结尾卡：按字号/对齐分组
cta = next((ts, te) for ts, te, s in timeline if s.get("role") == "cta")
ec_groups = {}
for e in D["endcard_texts"]:
    gk = (e.get("font", "sub"), e.get("align", 0), e.get("stroke", 2),
          e.get("anim", ""), e.get("alpha", 1.0), e["size"], e["y"])
    ec_groups.setdefault(gk, ([], []))[0].append(
        (e["text"], round(cta[0] + e.get("start", 0.1), 3),
         round(cta[1] - e.get("end", 0.05), 3)))
    ec_groups[gk][1].append(e)
for (font, align, stroke, anim, alpha, size, ypos_ass), (items, metas) in ec_groups.items():
    color = C.get(metas[0]["color"], metas[0]["color"])
    ypos = ty(ypos_ass, size)
    text_group(TR["endcard"], items, F.get(font, font), size, color, stroke,
               ypos, anim, metas[0].get("anim_dur", 0.25),
               {"align": align, "font_alpha": alpha},
               f"结尾卡{len(items)}", solo=True)

# 剪映原生文字模板：必须先预览真实资源再填ID；不使用杜撰ID。
# start/end 为最终ASR对齐后的全局秒数。模板须有独立轨，避免与普通花字重复。
for i, tpl in enumerate(D.get("text_templates", [])):
    if not tpl.get("enabled", True):
        continue
    if not tpl.get("template_id") or not tpl.get("preview_verified"):
        raise ValueError("文字模板必须填写已预览核实的 template_id")
    texts = tpl.get("texts", [])
    if len(texts) != tpl.get("texts_count"):
        raise ValueError("文字模板 texts 数量与预览 texts_count 不符")
    start, end = tpl["start"], tpl["end"]
    if not 0 <= start < end <= TOTAL:
        raise ValueError("文字模板时间超出本次时间轴")
    args = {"template_id": tpl["template_id"], "texts": texts,
            "start": start, "end": end,
            "track_name": tpl.get("track_name", f"08文字模板·{i+1}"),
            "width": W, "height": H}
    for key in ("transform_y_px", "transform_x_px", "scale_x", "scale_y", "rotation"):
        if key in tpl:
            args[key] = tpl[key]
    add("add_text_template", args, f"文字模板{i+1}")

# 常驻标注
tail = round(TOTAL - 3.2, 3)
# 顶部/底部/角标同屏共存，剪映不允许同文字轨重叠 -> 各占一条轨
persist = [(GT.get("top_disclaimer"), 26, 0.55, D["pos"]["top"], 2),
           (GT.get("footer"), 24, 0.62, D["pos"]["foot"], 2)]
for i, (text, size, alpha, ypos, align) in enumerate(persist):
    if not text:
        continue
    add("add_batch_text", {
        "texts": [text], "starts": [0.1], "ends": [tail],
        "track_name": f'{TR["persist"]}·{i + 1}', "font": F["small"],
        "font_size": fs(size),
        "font_color": C["white"], "font_alpha": alpha, "border_width": sw(2, size),
        "border_color": "#000000", "transform_y_px": ty(ypos, size),
        "align": align, "width": W, "height": H,
    }, f"常驻标注{i + 1}")
if GT.get("bottom_right"):
    add("add_batch_text", {
        "texts": [GT["bottom_right"]], "starts": [0.1], "ends": [11.6],
        "track_name": TR["persist"] + "·3", "font": F["small"], "font_size": fs(22),
        "font_color": C["white"], "font_alpha": 0.45,
        "transform_y_px": ty(D["pos"]["watermark"], 22), "transform_x_px": 2 * 300,
        "align": 2, "width": W, "height": H,
    }, "AI 说明角标")

# ---------------------------------------------------------------- 4 音频层
import wave
def wav_dur(p):
    try:
        with wave.open(os.path.join(ROOT, p) if not os.path.isabs(p) else p) as w:
            return round(w.getnframes() / w.getframerate(), 3)
    except Exception:
        return None

vos, vo_starts, vo_durs = [], [], []
for ts, te, s in timeline:
    if s.get("vo"):
        vos.append(s["vo"]); vo_starts.append(round(ts + s.get("vo_offset", 0), 3))
        vo_durs.append(wav_dur(s["vo"]))
add("add_batch_audio", {"audio_urls": vos, "target_starts": vo_starts,
                        "target_ends": [round(a + (b or 0), 3)
                                        for a, b in zip(vo_starts, vo_durs)],
                        "durations": vo_durs, "track_name": TR["vo"],
                        "volume": AUDIO.get("vo_gain_db", 0)}, f"配音 {len(vos)} 条")
# 逐条音量各不同，add_batch_audio 只吃全局 volume -> 音效单独加
for ts, te, s in timeline:
    for sx in s.get("sfx", []):
        add("add_audio", {"audio_url": sx["src"],
                          "target_start": round(ts + sx.get("at", 0), 3),
                          "start": 0, "end": wav_dur(sx["src"]),
                          "duration": wav_dur(sx["src"]),
                          "track_name": TR["sfx"],
                          "volume": sx.get("gain", -8)},
            f"{s['id']} 音效")
add("add_audio", {"audio_url": AUDIO.get("bgm_loop", AUDIO["bgm"]),
                  "target_start": 0, "start": 0, "end": TOTAL,
                  "duration": TOTAL, "track_name": TR["bgm"],
                  "volume": AUDIO.get("bgm_gain_db", -12),
                  "fade_in_duration": 0.3,
                  "fade_out_duratioin": AUDIO.get("fade_out", 0.7)}, "BGM")

# ---------------------------------------------------------------- 产物
# --only <关键字>：只导出匹配的 op，方便「改完结尾卡文案就只重跑结尾卡」而不必重建整盘。
# 执行器会跳过失败项，所以往已有草稿里补层时，同轨已存在的层会报 overlap，属正常。
if "--only" in sys.argv:
    key = sys.argv[sys.argv.index("--only") + 1]
    before = len(ops)
    ops = [o for o in ops
           if key in o["_note"] or key in str(o["args"].get("track_name", ""))]
    print(f"--only {key!r}: {before} -> {len(ops)} ops")

out_json = os.path.join(ROOT, "draft_ops.json")
json.dump({"meta": {"total": TOTAL, "canvas": [W, H], "ops_count": len(ops)},
           "ops": ops},
          open(out_json, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

draft_arg = ""
if "--draft" in sys.argv:
    draft_arg = sys.argv[sys.argv.index("--draft") + 1]
slim = [{"tool": o["tool"], "_note": o["_note"],
         "args": json.loads(json.dumps(o["args"], ensure_ascii=False)
                            .replace(ROOT + "/", "@@/"))} for o in ops]
js = ["// 自动生成：scripts/build_draft.py —— 请勿手改，改 edit_plan.json 后重新生成",
      f'const DRAFT = "{draft_arg or "{{DRAFT_ID}}"}";',
      f'const B = {json.dumps(ROOT)};',
      "const OPS = " + json.dumps(slim, ensure_ascii=False) + ";",
      "const out = [];",
      "for (const op of OPS) {",
      "  const args = JSON.parse(JSON.stringify(op.args).replace(/@@\\//g, B + '/'));",
      "  args.draft_id = DRAFT;",
      "  const t0 = Date.now();",
      "  try { const r = await tools[op.tool](args);",
      "        const o = typeof r === 'string' ? JSON.parse(r) : r;",
      "        out.push({ n: op._note, ok: o.success, err: (o.error || '').slice(0, 120), ms: Date.now() - t0 }); }",
      "  catch (e) { out.push({ n: op._note, ok: false, err: String(e).slice(0, 120), ms: Date.now() - t0 }); }",
      "}",
      "return out;"]
out_js = os.path.join(ROOT, "draft_exec.js")
open(out_js, "w", encoding="utf-8").write("\n".join(js) + "\n")

if "--show" in sys.argv:
    print(f"{'起':>6} {'止':>6}  {'id':<5} {'role':<11} 类型   内容")
    for ts, te, s in timeline:
        full, kw = hl_parse(s.get("sub") or "")
        txt = s.get("key") or full or "-"
        print(f"{ts:6.2f} {te:6.2f}  {s['id']:<5} {s.get('role',''):<11} "
              f"{s['type']:<6} {txt[:30]}")
    print(f"\ntotal {TOTAL}s")
    for o in ops:
        n = len(o["args"].get("texts", [])) or len(o["args"].get("video_urls", [])) or 1
        print(f"  {o['tool'].split('__')[-1]:<22} {o['_note']}")
print(f"\n{len(ops)} ops -> draft_ops.json / draft_exec.js ({os.path.getsize(out_js)} B)")
