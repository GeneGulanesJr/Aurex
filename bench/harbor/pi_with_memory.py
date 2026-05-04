"""
PiWithMemory — Custom Harbor agent that extends the built-in Pi agent
with PiMemoryExtension v6 skills injected.

Key differences from vanilla Pi:
- Copies PiMemoryExtension skill files into Pi's skills directory
- Rewrites Ollama baseUrl from 127.0.0.1 → 172.17.0.1 for Docker bridge networking
- Copies existing Pi config (models.json, settings.json, auth.json) into container
"""

import json
import os
import shlex

from harbor.agents.installed.base import (
    BaseInstalledAgent,
    CliFlag,
    with_prompt_template,
)
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class PiWithMemory(BaseInstalledAgent):
    _OUTPUT_FILENAME = "pi.txt"

    CLI_FLAGS = [
        CliFlag(
            "thinking",
            cli="--thinking",
            type="enum",
            choices=["off", "minimal", "low", "medium", "high", "xhigh"],
        ),
    ]

    @staticmethod
    def name() -> str:
        return "pi-with-memory"

    def get_version_command(self) -> str | None:
        return ". ~/.nvm/nvm.sh; pi --version"

    def parse_version(self, stdout: str) -> str:
        return stdout.strip().splitlines()[-1].strip()

    async def install(self, environment: BaseEnvironment) -> None:
        # Install system deps
        await self.exec_as_root(
            environment,
            command="apt-get update && apt-get install -y curl",
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )
        # Install Pi via npm
        version_spec = f"@{self._version}" if self._version else "@latest"
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash && "
                'export NVM_DIR="$HOME/.nvm" && '
                '\\. "$NVM_DIR/nvm.sh" || true && '
                "command -v nvm &>/dev/null || { echo 'Error: NVM failed to load' >&2; exit 1; } && "
                "nvm install 22 && npm -v && "
                f"npm install -g @mariozechner/pi-coding-agent{version_spec} && "
                "pi --version"
            ),
        )

    async def _setup_pi_config(self, environment: BaseEnvironment) -> None:
        """Copy Pi's existing config into the container, rewriting localhost → Docker bridge IP."""

        pi_agent_dir = os.path.expanduser("~/.pi/agent")
        skills_src = os.path.expanduser("~/.pi/agent/skills/memory-layer")

        # Upload Pi config files
        for filename in ["models.json", "settings.json", "auth.json"]:
            src = os.path.join(pi_agent_dir, filename)
            if os.path.exists(src):
                content = open(src).read()
                # Rewrite localhost URLs for Docker bridge networking
                content = content.replace("http://127.0.0.1:", "http://172.17.0.1:")
                content = content.replace("http://localhost:", "http://172.17.0.1:")
                # Write to container
                remote_path = f"$HOME/.pi/agent/{filename}"
                await self.exec_as_agent(
                    environment,
                    command=f"mkdir -p $HOME/.pi/agent && cat > {remote_path} << '__PI_CONFIG_EOF__'\n{content}\n__PI_CONFIG_EOF__",
                )

        # Copy PiMemoryExtension skill into container
        if os.path.isdir(skills_src):
            # Create a tarball of the skill directory
            import subprocess
            import tarfile
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
                tmp_path = tmp.name

            with tarfile.open(tmp_path, "w:gz") as tar:
                tar.add(skills_src, arcname="memory-layer")

            # Copy tarball into container and extract
            container_tmp = "/tmp/memory-layer.tar.gz"
            await self.exec_as_agent(
                environment,
                command=f"mkdir -p $HOME/.pi/agent/skills",
            )
            # Harbor's exec_as_agent doesn't support file transfer directly,
            # so we'll use a heredoc-encoded base64 approach for small files
            import base64
            with open(tmp_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode()

            await self.exec_as_agent(
                environment,
                command=(
                    f"echo '{encoded}' | base64 -d > {container_tmp} && "
                    f"tar xzf {container_tmp} -C $HOME/.pi/agent/skills/ && "
                    f"rm {container_tmp} && "
                    f"echo 'Memory layer skill installed: $(ls $HOME/.pi/agent/skills/memory-layer/*.js | wc -l) files'"
                ),
            )

            os.unlink(tmp_path)
        else:
            raise FileNotFoundError(
                f"PiMemoryExtension skill not found at {skills_src}. "
                "Run: rsync -av ~/Documents/GulanesKorp/PiMemoryExtension/ ~/.pi/agent/skills/memory-layer/"
            )

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        escaped_instruction = shlex.quote(instruction)

        cli_flags = self.build_cli_flags()
        if cli_flags:
            cli_flags += " "

        KILO_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbnYiOiJwcm9kdWN0aW9uIiwia2lsb1VzZXJJZCI6ImU3NDlkOGI0LTc4ZGMtNDliMS1iYTE3LTc5ZjMyZTY5NTlhNSIsImFwaVRva2VuUGVwcGVyIjpudWxsLCJ2ZXJzaW9uIjozLCJpYXQiOjE3Nzc4NjA1OTAsImV4cCI6MTkzNTU0MDU5MH0.JP0GMB4uwQPDnl5_P3iQLLHK4cLUnwiCiC0MRTdykZE"

        # Write minimal models.json for kilo provider
        MINIMAL_MODELS = '{"providers":{"kilo":{"api":"openai-completions","apiKey":"' + KILO_API_KEY + '","baseUrl":"https://api.kilo.ai/api/gateway/v1","models":[{"id":"poolside/laguna-m.1:free"}]}}}'
        import base64 as _b64
        encoded = _b64.b64encode(MINIMAL_MODELS.encode()).decode()
        await self.exec_as_agent(
            environment,
            command=f"mkdir -p ~/.pi/agent && echo {shlex.quote(encoded)} | base64 -d > ~/.pi/agent/models.json",
        )

        # Install memory layer skill — write files one-by-one via python -c to avoid arg length limits
        skills_src = os.path.expanduser("~/.pi/agent/skills/memory-layer")
        if os.path.isdir(skills_src):
            import glob as _glob
            mem_files = _glob.glob(os.path.join(skills_src, "*.js")) + _glob.glob(os.path.join(skills_src, "*.md"))
            # Copy SKILL.md first (small, needed for Pi to recognize the skill)
            skill_md = os.path.join(skills_src, "SKILL.md")
            if os.path.exists(skill_md):
                contents = open(skill_md).read().replace("'", "'\\''")
                await self.exec_as_agent(
                    environment,
                    command=f"mkdir -p ~/.pi/agent/skills/memory-layer && echo '{contents}' > ~/.pi/agent/skills/memory-layer/SKILL.md",
                )
            # Copy essential JS files (only the ones Pi actually loads)
            essential = ["memory-store.js", "db.js", "wire-format.js", "response-meta.js"]
            for fname in essential:
                fpath = os.path.join(skills_src, fname)
                if os.path.exists(fpath):
                    # Use base64 to safely transfer binary content
                    import base64
                    with open(fpath, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode()
                    await self.exec_as_agent(
                        environment,
                        command=(
                            f"mkdir -p ~/.pi/agent/skills/memory-layer && "
                            f"echo {shlex.quote(b64)} | base64 -d > ~/.pi/agent/skills/memory-layer/{fname}"
                        ),
                    )
                    # Also set executable if needed
                    await self.exec_as_agent(
                        environment,
                        command=f"chmod +x ~/.pi/agent/skills/memory-layer/{fname} 2>/dev/null; true",
                    )

        # Pre-index the /testbed repo so memory-code tools can analyze it
        await self.exec_as_agent(
            environment,
            command=(
                f". ~/.nvm/nvm.sh; "
                f"node ~/.pi/agent/skills/memory-layer/memory-store.js index-repo --path /testbed --name testbed 2>&1 || echo 'index-repo skipped'"
            ),
        )

        await self.exec_as_agent(
            environment,
            command=(
                f". ~/.nvm/nvm.sh; "
                f"pi --print --mode json "
                f"--provider kilo "
                f"--model poolside/laguna-m.1:free "
                f"{cli_flags}"
                f"{escaped_instruction} "
                f" > /logs/agent/{self._OUTPUT_FILENAME} 2>&1"
            ),
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        """Parse Pi's JSON output to extract token usage."""
        import json

        output_file = self.logs_dir / self._OUTPUT_FILENAME
        if not output_file.exists():
            return

        total_input_tokens = 0
        total_output_tokens = 0
        total_cache_read_tokens = 0
        total_cache_write_tokens = 0
        total_cost = 0.0

        for line in output_file.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                if event.get("type") == "message_end":
                    message = event.get("message") or {}
                    if message.get("role") == "assistant":
                        usage = message.get("usage") or {}
                        total_input_tokens += usage.get("input", 0)
                        total_output_tokens += usage.get("output", 0)
                        total_cache_read_tokens += usage.get("cacheRead", 0)
                        total_cache_write_tokens += usage.get("cacheWrite", 0)
                        cost = usage.get("cost") or {}
                        total_cost += cost.get("total", 0.0)
            except (json.JSONDecodeError, AttributeError, TypeError):
                continue

        context.n_input_tokens = total_input_tokens + total_cache_read_tokens
        context.n_output_tokens = total_output_tokens
        context.n_cache_tokens = total_cache_read_tokens
        context.cost_usd = total_cost if total_cost > 0 else None
