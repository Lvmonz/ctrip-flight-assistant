#!/bin/bash
# ==============================================================================
# 携程机票助手 - 开发与部署工具脚本 (deploy_and_reset.sh)
# 
# 功能：
# 1. 将当前目录代码提交并推送到 GitHub
# 2. 将最新的 Skill 代码同步包到本地 Docker 容器中
# 3. 彻底清空 OpenClaw Agent 的全部记忆、日志、以及浏览器缓存，恢复到"出厂"的全新状态
# 4. 重启关联的 Docker 容器
# ==============================================================================

# 1. 提交并推送到 GitHub
echo "🚀 [1/4] 正在提交并推送到 GitHub..."
git add -A
git commit -m "chore: auto sync and deploy" || true
git push origin main
echo "✅ GitHub 同步完成。"

# 2. 同步 Skill 代码到 OpenClaw 容器内
echo "📦 [2/4] 正在将代码同步到 OpenClaw 容器..."
# 找到名为 openclaw-main 或者相关联的 openclaw 容器
CONTAINER_NAME=$(docker ps --format '{{.Names}}' | grep -i 'openclaw' | grep -iv 'browser' | head -1)
if [ -n "$CONTAINER_NAME" ]; then
    # Docker 方式: 复制代码到容器内的 skills 目录
    SKILLS_DIR=$(docker exec "$CONTAINER_NAME" find /home -name "skills" -path "*/.openclaw/*" -type d 2>/dev/null | head -1)
    if [ -n "$SKILLS_DIR" ]; then
        docker cp . "$CONTAINER_NAME:$SKILLS_DIR/ctrip-flight/"
        echo "✅ 代码已同步至容器 $CONTAINER_NAME:$SKILLS_DIR/ctrip-flight/"
    else
        echo "⚠️ 未在容器 $CONTAINER_NAME 内找到 skills 目录"
    fi
else
    echo "⚠️ 未找到正在运行的 OpenClaw 核心容器"
fi

# 3. 彻底洗脑：清空 OpenClaw 的各类状态
echo "🧹 [3/4] 正在清空 OpenClaw 状态和记忆..."
if [ -n "$CONTAINER_NAME" ]; then
    docker exec "$CONTAINER_NAME" sh -c "
        rm -rf /home/node/.openclaw/workspace/memory/* \
               /home/node/.openclaw/workspace/MEMORY.md \
               /home/node/.openclaw/logs/* \
               /home/node/.openclaw/workspace/ctrip_cookies.json \
               /home/node/.openclaw/workspace/.auth \
               /tmp/openclaw/* \
               2>/dev/null || true
    "
    echo "✅ OpenClaw 核心容器记忆与日志清空完成。"
fi

# 获取浏览器容器
BROWSER_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i 'openclaw-browser' | head -1)
if [ -n "$BROWSER_CONTAINER" ]; then
    docker exec -u root "$BROWSER_CONTAINER" sh -c "rm -rf /home/browserless/chrome/user-data/* 2>/dev/null || true"
    echo "✅ OpenClaw 浏览器容器的隐身缓存与 Cookie 清空完成。"
else
    echo "⚠️ 未找到正在运行的 OpenClaw 浏览器容器"
fi

# 4. 重启相关 Docker 容器
echo "🔄 [4/4] 正在重启 Docker 容器..."
if [ -n "$CONTAINER_NAME" ] && [ -n "$BROWSER_CONTAINER" ]; then
    docker restart "$CONTAINER_NAME" "$BROWSER_CONTAINER"
    echo "✅ 容器已重启成功！准备就绪！"
elif [ -n "$CONTAINER_NAME" ]; then
    docker restart "$CONTAINER_NAME"
    echo "✅ $CONTAINER_NAME 容器已重启成功！"
fi

echo "=============================================================================="
echo "🎉 所有操作完成！OpenClaw 已恢复出厂状态，并加载了最新的携程机票助手 Skill。"
echo "=============================================================================="
