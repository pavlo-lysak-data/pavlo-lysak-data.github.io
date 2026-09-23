# Complete Linux Networking & Security Interactive Course

A static course website that preserves the original eight-module course as its foundation, then expands the scope of Milan Milanović's DevOps Roadmap section **4. Learn Networking & Security** with current primary networking, zero-trust, monitoring, and DevSecOps guidance.

## Included

- 12 modules
- Assessment-aligned theory with objectives, technical mechanics, and operational use cases
- 120 multiple-choice questions with answer explanations taught in the preceding theory
- 12 KodeKloud-style simulated labs (72 tasks)
- Task-by-task lab preparation with command reasoning and expected evidence
- Browser-local progress tracking
- Responsive, dependency-free interface

Modules 1–8 are the canonical ground-zero curriculum. Modules 9–12 extend it with VLANs and segmentation; proxies, VPNs, and zero trust; IDS/IPS and observability; and a DevSecOps network-security capstone.

## Run

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000`.

The in-browser terminal is a simulator and never executes commands on your computer.

## Hosting

Published at https://pavlo-lysak-data.github.io/networking-security-lab/ .
The course runs as static files on GitHub Pages. Gemini and GPT tutor requests
use the existing backend at https://networking-security-lab.yagami-tsuki.chatgpt.site/api/tutor .
API credentials remain on that backend. Progress is stored in this browser and
is separate from progress saved on the original domain.

Snapshot from original Site source commit fcd280d88a01a6af3cbb7934747bf50221fea444,
with only the tutor endpoint changed for cross-origin hosting.
