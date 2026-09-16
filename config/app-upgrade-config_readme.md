gh proxy candidates can be collected from `https://github.akams.cn/`.

Probe requirements:
- Do not only check connectivity.
- Must really fetch `https://github.com/sun-guannan/CapCutMaker/releases/latest/download/latest.yml`.
- Must really do ZIP range download checks.
- Must verify a deep range near `600MB`, not only the file head.

Automation script:

```bash
python3 /Users/sunguannan/CapCutHelper/config/refresh_app-upgrade-config.py
python3 /Users/sunguannan/CapCutHelper/config/refresh_app-upgrade-config.py --dry-run
python3 /Users/sunguannan/CapCutHelper/config/refresh_app-upgrade-config.py --publish
```

Behavior:
- Default: probe candidates, keep the best 5 proxies, and update local `app-upgrade-config.json`
- `--dry-run`: print results only, do not write or publish
- `--publish`: update config and then publish it through `publish_app-upgrade-config.py`
