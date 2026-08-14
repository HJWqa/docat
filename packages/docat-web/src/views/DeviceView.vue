<template>
  <div class="device-page" tabindex="0" @click="onPageClick">
    <!-- Top Bar -->
    <header class="workspace-header">
      <div class="workspace-header-left">
        <router-link to="/" class="back-btn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          返回主控台
        </router-link>
        <div class="top-bar-device">
          <h2>{{ device?.name || '设备' }}</h2>
          <span class="top-bar-ip">{{ device?.ip }}</span>
        </div>
      </div>
      <div class="workspace-header-center">
        <!-- Magician 只支持串口模式，隐藏顶部 控制/编程/TCP 切换 -->
        <div v-if="!isMagician" class="workspace-switch">
          <router-link :to="{ path: `/device/${deviceId}`, query: $route.query }" class="workspace-switch-btn workspace-switch-btn--active">
            控制
          </router-link>
          <router-link :to="{ path: `/device/${deviceId}/programming`, query: $route.query }" class="workspace-switch-btn">
            编程
          </router-link>
          <router-link :to="{ path: `/device/${deviceId}/tcp`, query: $route.query }" class="workspace-switch-btn">
            TCP
          </router-link>
        </div>
      </div>
      <div class="workspace-header-actions">
        <!-- Magician：清除告警常驻右上角（已连接左侧），F9 同样触发 -->
        <button v-if="isMagician" class="btn btn-danger btn-sm" @click="doClearAlarm" title="清除告警 (F9)">清除告警</button>
        <span :class="['connection-badge', isVirtualMode ? 'connection-badge--virtual' : isConnected ? (tcpDown ? 'connection-badge--warning' : 'connection-badge--online') : 'connection-badge--offline']">
          <span class="status-dot" :class="`status-dot--${isVirtualMode ? 'virtual' : isConnected ? (tcpDown ? 'warning' : 'connected') : 'disconnected'}`" />
          <template v-if="isVirtualMode">
            <span class="bic">
              <svg width="12" height="12" viewBox="0 0 16 16"><path d="M8 2 9.5 6.5 14 8 9.5 9.5 8 14 6.5 9.5 2 8 6.5 6.5Z" fill="currentColor" /></svg>
            </span>虚拟连接
          </template>
          <template v-else-if="isConnected && !tcpDown">
            <span class="bic">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>已连接
          </template>
          <template v-else-if="isConnected">
            <span class="bic">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 2.5 14.5 13.5h-13L8 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                <path d="M8 6.5v3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                <circle cx="8" cy="11.4" r="0.7" fill="currentColor" />
              </svg>
            </span>TCP 异常
          </template>
          <template v-else>
            <span class="bic">
              <svg width="12" height="12" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="currentColor" /></svg>
            </span>离线
          </template>
        </span>
        <!-- Enable Toggle Switch（Magician 无使能概念，隐藏） -->
        <label v-if="isConnected && !isMagician" class="toggle-switch" title="使能开关 (Ctrl+E)">
          <input type="checkbox" :checked="enabled" @change="toggleEnable" />
          <span class="toggle-track">
            <span class="toggle-thumb" />
          </span>
          <span class="toggle-label">
            <span class="toggle-label-main" :class="{ 'is-on': enabled && !enabling }">{{ enabling ? '使能中...' : enabled ? '已使能' : '未使能' }}</span>
            <span class="toggle-label-load" :class="{ 'is-inactive': !(enabled && !enabling) }" :title="loadBadgeTitle">{{ loadBadgeText }}</span>
          </span>
        </label>
        <button v-if="!isConnected" class="btn btn-success btn-sm" @click="doConnect()" :disabled="connecting">
          {{ connecting ? '连接中...' : '连接' }}
        </button>
        <button :class="['btn btn-sm', showLogs ? 'btn-primary' : 'btn-secondary']" @click="toggleLogs">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1"/><line x1="5" y1="9" x2="10" y2="9" stroke="currentColor" stroke-width="1"/><line x1="5" y1="12" x2="8" y2="12" stroke="currentColor" stroke-width="1"/></svg>
          日志{{ deviceLogs.length > 0 ? ` (${deviceLogs.length})` : '' }}
        </button>
        <button :class="['btn btn-sm', showSettings ? 'btn-primary' : 'btn-secondary']" @click="toggleSettings" :disabled="!isConnected" title="设备设置">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          设置
        </button>
        <div class="dobotplus-toolbar" v-if="dobotPlusList.length > 0">
          <button class="btn btn-sm btn-secondary" @click="showDobotPlusBar = !showDobotPlusBar" title="Dobot+ 插件">
            <span class="bic" v-html="svgIcons.puzzle"></span>DOBOT+
          </button>
          <Transition name="fade">
            <div v-if="showDobotPlusBar" class="dobotplus-dropdown">
              <button v-for="name in dobotPlusList" :key="name" class="dobotplus-dropdown-item"
                @click="openDobotPlusPlugin(name); showDobotPlusBar = false"
                :title="dobotPlusTooltip(name)">
                <span class="bic" v-html="svgIcons.puzzle"></span> {{ name }}
              </button>
            </div>
          </Transition>
        </div>
        <button class="btn btn-secondary btn-sm" @click="doLogout">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l4-4-4-4M15 7H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </header>

    <!-- Pose HUD -->
    <div class="status-grid mt-2">
      <div class="card pose-card">
        <div class="hud-label pose-hud-label">
          <span>位姿</span>
          <button class="btn-icon btn-icon--copy" :disabled="!poseAvailable" @click="copyCurrentPose" title="复制当前位姿（逗号分隔）">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 2.5h-7a1 1 0 00-1 1v7" stroke="currentColor" stroke-width="1.3"/></svg>
          </button>
        </div>
        <div class="pose-readout">
          <div v-for="axis in poseAxes" :key="axis" class="pose-axis-row">
            <span class="pose-axis-label">{{ axis.toUpperCase() }}</span>
            <span class="pose-axis-value">{{ getPoseVal(axis) }}</span>
            <span class="pose-axis-unit">{{ axis.startsWith('r') ? '°' : 'mm' }}</span>
          </div>
        </div>
      </div>

      <div class="card joint-card">
        <div class="hud-label">关节角度</div>
        <div class="joint-readout">
          <div v-for="j in jointCount" :key="j" class="joint-row">
            <span class="joint-label">J{{ j }}</span>
            <div class="joint-gauge">
              <div class="joint-gauge-track">
                <div class="joint-gauge-fill" :style="{ width: jointPercent(j) + '%' }" />
                <div class="joint-gauge-center" />
              </div>
            </div>
            <span class="joint-value">{{ getJoint(j) }}</span>
          </div>
        </div>
      </div>

      <!-- 3D Model / 标定辅助（Magician 无 3D 模型，直接显示标定辅助） -->
      <div class="card model-panel">
        <div class="model-panel-header">
          <div>
            <div class="hud-label" style="margin-bottom:0">{{ calibPanelActive ? '标定辅助' : '3D 模型' }}</div>
            <div class="model-subtitle" v-if="!calibPanelActive">{{ robotModelType }} · 实时关节姿态</div>
            <div class="model-subtitle" v-else>图像坐标 → 物理坐标 · {{ calibModelLabel }} / {{ calibWeightLabel }}</div>
          </div>
          <div class="model-panel-actions">
            <button v-if="!calibPanelActive" class="btn btn-secondary btn-sm" @click="reset3DView">重置视角</button>
            <button
              v-if="!isMagician"
              class="btn-icon btn-icon--convert"
              :class="{ 'btn-icon--active': calibMode }"
              :title="calibMode ? '返回 3D 模型' : '标定辅助（图像坐标 ↔ 物理坐标）'"
              @click="toggleCalibMode"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-3 3M14 5H2M5 14l-3-3 3-3M2 11h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        <template v-if="!calibPanelActive">
          <div class="model-frame-shell">
            <iframe
              ref="modelIframeRef"
              class="model-frame"
              src="/3d/index.html"
              title="Dobot 3D 模型"
              @load="on3DModelLoad"
            />
            <div v-if="!modelReady" class="model-loading">
              <span class="loading-ring"></span>
              <strong>加载模型中</strong>
            </div>
          </div>
        </template>

        <!-- 标定辅助 -->
        <div v-else class="calib-panel">
          <div class="calib-toolbar">
            <label title="几何变换模型">模型
              <select v-model="calibModel" class="calib-select">
                <option value="affine">仿射</option>
                <option value="homography">透视</option>
              </select>
            </label>
            <label title="权重函数 / 稳健估计方法">权重
              <select v-model="calibWeightFn" class="calib-select">
                <option value="lsq">最小二乘</option>
                <option value="huber">Huber</option>
                <option value="tukey">Tukey</option>
                <option value="ransac">RANSAC</option>
              </select>
            </label>
            <label v-if="calibWeightFn === 'ransac'" title="判定内点的允许误差上限 (mm)">阈值
              <input v-model.number="calibRansacThresh" type="number" min="0.01" step="0.1" class="calib-thresh-input" />
            </label>
            <span class="calib-rmse" :class="{ 'calib-rmse--bad': calibFit && !calibFit.usable }" :title="calibFitHint">
              RMSE {{ calibFit ? (Number.isFinite(calibFit.rmse) ? calibFit.rmse.toFixed(3) : '—') : '—' }} mm
            </span>
            <label title="行数（最小点数：仿射3 / 透视4）">行数
              <input v-model.number="calibRowCount" type="number" min="1" max="99" step="1" class="calib-rowcount-input" @change="syncCalibRows" @keyup.enter="syncCalibRows" />
            </label>
            <button class="btn-icon btn-icon--toolbar" @click="triggerCalibImport('image')" @contextmenu.prevent="triggerCalibImport('full')" title="文件导入（左键：仅图像坐标；右键：保留全部数据）">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M9.5 1.5H4A1.5 1.5 0 002.5 3v10A1.5 1.5 0 004 14.5h8A1.5 1.5 0 0013.5 13V5z" stroke="currentColor" stroke-width="1.3"/><path d="M9.5 1.5V5H13" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn-icon btn-icon--toolbar" @click="startClipboardImport('image')" @contextmenu.prevent="startClipboardImport('full')" title="从剪贴板导入 OCR 坐标（左键：仅图像坐标；右键：保留全部数据）">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 6h7M4.5 8.5h4.5M4.5 11h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            </button>
            <button class="btn-icon btn-icon--toolbar" @click="exportCalibrationToServer" @contextmenu.prevent="downloadCalibration" title="导出 txt（左键：服务端写入导出目录；右键：下载 txt 文件）">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M8 10l-3-3M8 10l3-3M2 13h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn-icon btn-icon--toolbar" @click="exportCalibrationXmlToServer" @contextmenu.prevent="downloadCalibrationXml" title="导出 xml（左键：服务端写入导出目录；右键：下载 xml 文件）">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 4l-3 4 3 4M11 4l3 4-3 4M9.5 3l-3 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <input ref="calibFileInputRef" type="file" accept=".txt,.text,.xml" style="display:none" @change="onCalibFileChange" />
          </div>

          <div v-if="calibPasteOpen" class="calib-paste-box">
            <span class="calib-paste-hint">将 OCR 坐标文本粘贴到此（{{ calibPasteMode === 'full' ? '全部数据' : '仅图像坐标' }}，数量须为当前行数 {{ calibRowCount }} 的 {{ calibPasteMode === 'full' ? 5 : 2 }} 倍）</span>
            <textarea ref="calibPasteRef" v-model="calibPasteText" class="calib-paste-input" rows="3" @keyup.esc="cancelCalibPaste" placeholder="每行一个数字，按列顺序粘贴"></textarea>
            <div class="calib-paste-actions">
              <button class="btn btn-primary btn-sm" @click="confirmCalibPaste">确定</button>
              <button class="btn btn-secondary btn-sm" @click="cancelCalibPaste">取消</button>
            </div>
          </div>

          <div class="calib-table-wrap">
            <table class="calib-table">
              <thead>
                <tr>
                  <th style="width:28px">#</th>
                  <th>图像X</th>
                  <th>图像Y</th>
                  <th>物理X</th>
                  <th>物理Y</th>
                  <th>角度</th>
                  <th style="width:74px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in calibRows" :key="i" :class="{ 'calib-row--inactive': calibInactiveSet[i] }">
                  <td class="calib-idx">{{ i + 1 }}</td>
                  <td><input v-model.number="row.imgX" type="number" step="any" title="图像坐标 X" /></td>
                  <td><input v-model.number="row.imgY" type="number" step="any" title="图像坐标 Y" /></td>
                  <td><input v-model.number="row.physX" type="number" step="any" title="物理坐标 X" /></td>
                  <td><input v-model.number="row.physY" type="number" step="any" title="物理坐标 Y" /></td>
                  <td><input v-model.number="row.angle" type="number" step="any" title="角度（当前仅记录参考）" /></td>
                  <td>
                    <button class="btn btn-secondary btn-xs" :disabled="!hasLivePose" @click="readCurrentXY(i)" title="读取当前物理坐标填入物理X/Y">读取XY</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="calib-convert">
            <span class="calib-convert-label">图像坐标</span>
            <input v-model.trim="calibConvertInput" class="calib-convert-input" placeholder="图X 图Y 或 图X,图Y" title="输入图像坐标，用逗号或任意个数空格分隔" @keyup.enter="runCalibConvert" />
            <button class="btn btn-primary btn-sm" :disabled="!calibFit || !calibFit.usable" @click="runCalibConvert">转换</button>
            <input v-model.trim="calibConvertResult" class="calib-convert-input calib-convert-result" placeholder="物理X 物理Y 或 物理X,物理Y"
              title="转换结果；用逗号或任意个数空格分隔；Shift/Ctrl+Enter 移动到该位置"
              @input="calibConvertDirty = true" @keydown="onCalibResultKeydown" />
          </div>
        </div>
      </div>
    </div>

    <!-- Alarms & Warnings -->
    <div v-if="hasAlarms || hasWarnings || isCollision" class="card alarm-panel mt-2">
      <div class="alarm-panel-header">
        <span class="hud-label" style="margin-bottom:0;color:var(--status-danger)"><span class="bic" v-html="svgIcons.warn"></span>告警与警告</span>
        <div class="alarm-actions">
          <button v-if="hasAlarms && !isMagician" class="btn btn-danger btn-sm" @click="doClearAlarm" title="清除告警 (F9)">清除告警</button>
          <button v-if="hasWarnings" class="btn btn-warning btn-sm" @click="dismissWarnings" title="清除警告（F9）">清除警告</button>
          <button v-if="isCollision" class="btn btn-warning btn-sm" @click="doResetCollision" title="复位碰撞 (F9)">复位碰撞</button>
        </div>
      </div>
      <div class="alarm-list">
        <!-- Alarms -->
        <div v-for="a in currentAlarms" :key="'a'+a.id" class="alarm-item alarm-item--error">
          <div class="alarm-item-main">
            <span class="alarm-icon" v-html="svgIcons.x"></span>
            <span class="alarm-code">告警 #{{ a.id }}</span>
            <span v-if="a.level !== ''" class="alarm-level">等级 {{ a.level }}</span>
            <span v-if="a.date || a.time" class="alarm-time">{{ a.date }} {{ a.time }}</span>
          </div>
          <div class="alarm-detail">
            <div class="alarm-msg">{{ a.message }}</div>
            <div v-if="a.solution" class="alarm-solution">{{ a.solution }}</div>
          </div>
        </div>
        <!-- Warnings -->
        <div v-for="w in currentWarnings" :key="'w'+w.id" class="alarm-item alarm-item--warn">
          <div class="alarm-item-main">
            <span class="alarm-icon">!</span>
            <span class="alarm-code">警告 #{{ w.id }}</span>
            <span v-if="w.level !== ''" class="alarm-level">等级 {{ w.level }}</span>
            <span v-if="w.date || w.time" class="alarm-time">{{ w.date }} {{ w.time }}</span>
          </div>
          <div class="alarm-detail">
            <div class="alarm-msg">{{ w.message }}</div>
            <div v-if="w.solution" class="alarm-solution">{{ w.solution }}</div>
          </div>
        </div>
        <!-- Collision -->
        <div v-if="isCollision" class="alarm-item alarm-item--error">
          <span class="alarm-icon" v-html="svgIcons.warn"></span>
          <span class="alarm-code">碰撞</span>
          <span class="alarm-msg">碰撞检测触发 — 请确认安全后复位</span>
        </div>
        <!-- Protective Stop -->
        <div v-if="protectiveStop" class="alarm-item alarm-item--warn">
          <span class="alarm-icon" v-html="svgIcons.pause"></span>
          <span class="alarm-code">保护停止</span>
        </div>
        <!-- Emergency Stop -->
        <div v-if="emergencyStop" class="alarm-item alarm-item--error">
          <span class="alarm-icon" v-html="svgIcons.stop"></span>
          <span class="alarm-code">急停已触发</span>
        </div>
      </div>
    </div>

    <div class="control-grid mt-2">
      <!-- Jog Control Panel -->
      <div class="card jog-panel" ref="jogPanelRef" tabindex="-1" title="按 B / Alt+B 快速聚焦此板块">
        <div class="hud-label">手动点动控制</div>
        <div class="jog-panel-main">
          <div class="jog-panel-main-left">
            <div class="jog-panel-header">
              <div class="jog-settings">
              <div class="jog-settings-rows">
                  <div class="jog-settings-row">
                    <!-- Magician（串口模式）无 手动自动/自动/手动/TCP/ONLINE 模式切换 -->
                    <template v-if="!isMagician">
                    <div class="mode-switch-group">
                      <span class="amp-limit-label">手动自动</span>
                      <label class="toggle-switch">
                        <input type="checkbox" :checked="autoModeEnabled" @change="toggleAutoModeEnabled" :disabled="modeSwitching" />
                        <span class="toggle-track"><span class="toggle-thumb" /></span>
                        <span class="toggle-label">{{ autoModeEnabled ? '开' : '关' }}</span>
                      </label>
                    </div>
                    <div class="jog-mode-selector">
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': isAutoMode }]" @click="setMode('auto')" :disabled="!autoModeEnabled || modeSwitching">自动</button>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': !isAutoMode }]" @click="setMode('manual')" :disabled="!autoModeEnabled || modeSwitching">手动</button>
                    </div>
                    <div class="jog-mode-selector">
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': !isOnlineMode }]" @click="setDeviceMode('tcp')" :disabled="isAutoMode || modeSwitching">TCP</button>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': isOnlineMode }]" @click="setDeviceMode('online')" :disabled="isAutoMode || modeSwitching">ONLINE</button>
                    </div>
                    </template>
                    <!-- 点动坐标系（按键/按钮动哪一套轴），与 MovJ/MovL 路径类型无关 -->
                    <div class="jog-mode-selector" :title="`点动时操作的坐标系：关节角 J1–J${jointCount}，或笛卡尔 ${isMagician ? 'X/Y/Z/R' : 'X/Y/Z/RX/RY/RZ'}`">
                      <button
                        :class="['jog-mode-btn', { 'jog-mode-btn--active': jogCoordinate === 'joint' }]"
                        :disabled="!isConnected || jogCoordSwitching"
                        @click="changeJogCoordinate('joint')"
                      >点动·关节</button>
                      <button
                        :class="['jog-mode-btn', { 'jog-mode-btn--active': jogCoordinate !== 'joint' }]"
                        :disabled="!isConnected || jogCoordSwitching"
                        @click="changeJogCoordinate('cartesian')"
                      >点动·笛卡尔</button>
                    </div>
                  </div>
                  <div class="jog-settings-row">
                    <!-- Amplitude limit -->
                    <div class="amp-limit">
                      <span class="amp-limit-label">最大增量</span>
                      <input
                        v-model.number="ampLimit"
                        type="number"
                        min="0"
                        max="500"
                        step="1"
                        class="amp-input"
                        title="聚焦时可改数值；填 0 表示不限制、持续移动。键盘点动请先点击页面空白处"
                      />
                      <span class="amp-limit-unit">{{ jogAxisUnit }}</span>
                    </div>
                    <div class="jog-mode-selector">
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': jogMode === 'continuous' }]" @click="changeJogMode('continuous')">连续</button>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': jogMode === 'step' }]" @click="changeJogMode('step')">步进</button>
                    </div>
                    <div v-if="jogMode === 'step'" class="inch-setting">
                      <span class="amp-limit-label">步长</span>
                      <input v-model.number="jogInch" type="number" min="0.01" step="0.01" class="amp-input" @change="applyTeachInch" />
                      <span class="amp-limit-unit">{{ jogCoordinate === 'joint' ? '°' : 'mm/°' }}</span>
                      <button v-for="value in inchPresets" :key="value" :class="['inch-preset', { 'inch-preset--active': jogInch === value }]" @click="setTeachInchPreset(value)">
                        {{ value }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="jog-body">
              <div class="jog-grid">
                <div v-for="axis in activeJogAxes" :key="axis" class="jog-axis-col">
                  <span class="jog-axis-name">{{ formatJogAxisName(axis) }}</span>
                  <button class="jog-btn" :class="{ 'jog-btn--active': jogActive && jogAxis === axis && jogDir === '+' }"
                    :disabled="!isConnected"
                    @mousedown.prevent="beginAxisJog(axis, '+')" @mouseup="stopJog" @mouseleave="stopJog"
                    @touchstart.prevent="beginAxisJog(axis, '+')" @touchend="stopJog">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M12 5l-6 6M12 5l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <span class="jog-axis-val">{{ formatJogAxisValue(axis) }}</span>
                  <button class="jog-btn jog-btn--down" :class="{ 'jog-btn--active': jogActive && jogAxis === axis && jogDir === '-' }"
                    :disabled="!isConnected"
                    @mousedown.prevent="beginAxisJog(axis, '-')" @mouseup="stopJog" @mouseleave="stopJog"
                    @touchstart.prevent="beginAxisJog(axis, '-')" @touchend="stopJog">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M12 19l-6-6M12 19l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <!-- 设备朝向：WASD + 方向键 X/Y 的方向模式，占三行高度（表头两行 + jog 按钮行） -->
          <div class="device-orientation">
            <span class="device-orientation-title">设备朝向</span>
            <div class="wasd-dir-picker" :title="`WASD 方向模式（当前：W 指向 ${wasdDirArrow}）：A=正向 B=反转 C=右转90° D=左转90°`">
              <button class="wasd-dir-btn wasd-dir-btn--c" :class="{ 'wasd-dir-btn--active': wasdDir === 'd' }" @click="setWasdDir('d')" title="D（左转90°）：W→X-  A→Y-  S→X+  D→Y+">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M12 5l-6 6M12 5l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="wasd-dir-btn wasd-dir-btn--a" :class="{ 'wasd-dir-btn--active': wasdDir === 'b' }" @click="setWasdDir('b')" title="B（反转）：W→Y-  A→X+  S→Y+  D→X-">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M5 12l6-6M5 12l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <div class="wasd-dir-center" :title="`当前方向：W 指向 ${wasdDirArrow}`">
                <svg v-if="isMagician" width="16" height="24" viewBox="0 0 200 300">
                  <circle cx="100" cy="100" r="90" fill="currentColor" />
                  <polygon points="30,110 170,110 100,255" fill="currentColor" />
                </svg>
                <svg v-else width="26" height="14.3" viewBox="0 0 800 440">
                  <path
                    d="M 200 20 H 600 C 710 20, 780 110, 780 220 C 780 330, 710 420, 600 420 H 570 C 560 420, 554 423, 549 429 C 544 435, 537 438, 528 438 H 465 C 456 438, 449 435, 444 429 C 439 423, 433 416, 423 412 H 350 C 340 412, 334 415, 329 421 C 324 427, 317 438, 308 438 H 280 C 271 438, 264 435, 259 429 C 254 423, 248 416, 238 412 H 200 C 90 420, 20 330, 20 220 C 20 110, 90 20, 200 20 Z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <button class="wasd-dir-btn wasd-dir-btn--b" :class="{ 'wasd-dir-btn--active': wasdDir === 'a' }" @click="setWasdDir('a')" title="A（正向）：W→Y+  A→X-  S→Y-  D→X+">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M19 12l-6-6M19 12l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="wasd-dir-btn wasd-dir-btn--d" :class="{ 'wasd-dir-btn--active': wasdDir === 'c' }" @click="setWasdDir('c')" title="C（右转90°）：W→X+  A→Y+  S→X-  D→Y-">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M12 19l-6-6M12 19l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="jog-shortcut-hints">
          <template v-for="(hint, hi) in activeShortcutHints" :key="hint.label">
            <span v-if="hi === 3" class="jog-shortcut-hints-break"></span>
            <span class="jog-shortcut-hint">
              <b>{{ hint.label }}</b>
              <kbd>{{ hint.pos }}</kbd>/<kbd>{{ hint.neg }}</kbd>
            </span>
          </template>
        </div>
      </div>

      <!-- Move To Position (joint + pose) -->
      <div class="card move-panel">
        <div class="move-panel-header">
          <span class="hud-label" style="margin-bottom:0">移动 / 预设</span>
          <div class="move-panel-actions">
            <div class="jog-mode-selector" title="预设存什么：关节角 joint[]，或笛卡尔位姿 pose[]（与 MovJ/MovL 路径无关）">
              <button
                :class="['jog-mode-btn', { 'jog-mode-btn--active': newPostureType === 'joint' }]"
                @click="newPostureType = 'joint'"
              >存·关节角</button>
              <button
                :class="['jog-mode-btn', { 'jog-mode-btn--active': newPostureType === 'cartesian' }]"
                @click="newPostureType = 'cartesian'"
              >存·位姿</button>
            </div>
            <input v-model.trim="newPostureName" class="preset-name-input" type="text" placeholder="预设名称"
              @keyup.enter="saveCurrentAsPosture" style="width:100px" />
            <button class="btn btn-primary btn-sm" :disabled="!isConnected || !newPostureName" @click="saveCurrentAsPosture" :title="newPostureType === 'cartesian' ? '保存当前位姿 pose' : '保存当前关节角 joint'"><span class="bic" v-html="svgIcons.save"></span>保存</button>
          </div>
        </div>
        <!-- 路径类型：与目标 joint/pose 正交（见 dobot-docs Motion.md） -->
        <div class="move-path-row">
          <span class="amp-limit-label">路径</span>
          <div class="jog-mode-selector">
            <button
              :class="['jog-mode-btn', { 'jog-mode-btn--active': movePath === 'MovJ' }]"
              @click="movePath = 'MovJ'"
              title="关节插补路径（MovJ），目标可以是关节角或笛卡尔位姿"
            >MovJ 关节路径</button>
            <button
              :class="['jog-mode-btn', { 'jog-mode-btn--active': movePath === 'MovL' }]"
              @click="movePath = 'MovL'"
              title="直线路径（MovL），目标可以是关节角或笛卡尔位姿"
            >MovL 直线路径</button>
          </div>
        </div>
        <div class="move-grid">
          <div v-for="j in 6" :key="j" class="move-field" :class="{ 'move-field--hidden': j > jointCount }">
            <label class="move-label">J{{ j }}</label>
            <input v-model.number="moveTarget['j'+j]" type="number" step="0.1" class="move-input"
              title="Shift/Ctrl+Enter 直接移动" @keydown="onMoveInputKeydown('joint', $event)" ref="jointInputRefs" />
            <span class="move-unit">°</span>
          </div>
          <button class="btn btn-secondary btn-sm move-paste-btn" @click="pasteToMoveTarget"
            title="从剪贴板粘贴坐标（空格/逗号分隔）">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="4" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4" />
              <path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4" />
              <path d="M5 7h6M5 9.5h6M5 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </button>
          <div class="move-read-row"><button class="btn btn-secondary btn-sm" :disabled="!isConnected" @click="readJointsAndFocus" title="读取当前关节角与笛卡尔位姿，并聚焦 J1 (Alt+N)；N 仅聚焦 J1">读取当前关节</button></div>
          <button class="btn btn-primary move-btn" :disabled="!isConnected || moving || poseMoving" @click="doMove">
            {{ moving ? '移动中...' : (movePath + ' 关节目标') }}
          </button>
          <button v-if="moving" class="btn btn-danger move-stop-btn" @click="() => stopMoveJoints()" title="停止运动 (Alt+Enter)">
            停止
          </button>
        </div>
        <!-- Pose targets -->
        <div class="move-grid" style="margin-top:10px">
          <div v-for="axis in fullPoseAxes" :key="axis" class="move-field" :class="{ 'move-field--hidden': hiddenPoseAxes.includes(axis) }">
            <label class="move-label">{{ axis.toUpperCase() }}</label>
            <input v-model.number="targetPose[axis]" type="number" step="0.1" class="move-input"
              title="Shift/Ctrl+Enter 直接移动" @keydown="onMoveInputKeydown('pose', $event)" ref="poseInputRefs" />
            <span class="move-unit">{{ axis.startsWith('r') ? '°' : 'mm' }}</span>
          </div>
          <button class="btn btn-secondary btn-sm move-paste-btn" @click="pasteToTargetPose"
            title="从剪贴板粘贴坐标（空格/逗号分隔）">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="4" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4" />
              <path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4" />
              <path d="M5 7h6M5 9.5h6M5 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </button>
          <div class="move-read-row"><button class="btn btn-secondary btn-sm" :disabled="!isConnected" @click="readPoseAndFocus" title="读取当前位姿并聚焦 X (Alt+M)；M 仅聚焦 X">读取当前位姿</button></div>
          <button class="btn btn-primary move-btn" :disabled="!isConnected || poseMoving || moving" @click="moveToPose">
            {{ poseMoving ? '移动中...' : (movePath + ' 位姿目标') }}
          </button>
          <button v-if="poseMoving" class="btn btn-danger move-stop-btn" @click="doStop" title="停止运动 (Alt+Enter)">停止</button>
        </div>

        <!-- Postures (system + controller) -->
        <div class="preset-section mt-2">
          <div class="preset-section-header" @click="postureListExpanded = !postureListExpanded" style="cursor:pointer">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="hud-label" style="margin-bottom:0">姿态</span>
              <span class="preset-count-badge">{{ allPostures.length }}</span>
            </div>
            <button class="btn-icon" :title="postureListExpanded ? '折叠' : '展开'"
              style="font-size:14px;color:var(--text-muted)">
              {{ postureListExpanded ? '▲' : '▼' }}
            </button>
          </div>

          <!-- Quick bar: first 7 postures (3 system + up to 4 custom) -->
          <div class="quick-posture-bar">
            <button v-for="p in allPostures.slice(0, 7)" :key="p._key"
              :class="['btn-quick-posture', { 'btn-quick-posture--sys': p.system, 'btn-quick-posture--cart': p.type === 'cartesian' }]"
              @click="fillPosture(p)"
              :title="formatPostureDetail(p)">
              <span class="qpi">{{ p.name }}</span>
              <span v-if="p.type === 'cartesian'" class="qpi-tag">XYZ</span>
            </button>
          </div>

          <!-- Full list (collapsible) -->
          <Transition name="preset-collapse">
            <div v-if="postureListExpanded" class="preset-list">
              <div v-for="(p, idx) in allPostures" :key="p._key"
                class="preset-item"
                :class="{
                  'preset-item--system': p.system,
                  'preset-item--cartesian': p.type === 'cartesian',
                  'preset-item--dragging': dragPostureIdx === idx,
                  'preset-item--dragover': dragPostureOver === idx && dragPostureIdx !== idx,
                }"
                :draggable="!p.system"
                @dragstart="onPostureDragStart($event, idx)"
                @dragover.prevent="onPostureDragOver(idx)"
                @dragleave="onPostureDragLeave"
                @drop="onPostureDrop(idx)"
                @dragend="onPostureDragEnd">
                <div v-if="!p.system" class="preset-item-grip" title="拖动以排序">⋮⋮</div>
                <div v-else class="preset-item-grip" style="visibility:hidden">⋮⋮</div>
                <div class="preset-item-info" @click="fillPosture(p)">
                  <template v-if="renamingPostureKey === p._key">
                    <input v-model.trim="renamePostureValue" class="preset-rename-input"
                      @keyup.enter="confirmRenamePosture(p)" @keyup.escape="renamingPostureKey = ''"
                      @click.stop @blur="confirmRenamePosture(p)" ref="renamePostureInputRef" />
                  </template>
                  <template v-else>
                    <span class="preset-item-name">
                      {{ p.name }}
                      <span v-if="p.type === 'cartesian'" class="preset-type-badge">位姿</span>
                      <span v-else-if="!p.system" class="preset-type-badge preset-type-badge--joint">关节角</span>
                    </span>
                  </template>
                  <span class="preset-item-joints">{{ formatPostureSummary(p) }}</span>
                </div>
                <div class="preset-item-actions">
                  <span v-if="p.system" class="preset-item-badge">系统</span>
                  <template v-else>
                    <button class="btn-icon" title="重命名" @click.stop="startRenamePosture(p)" v-html="svgIcons.pen"></button>
                    <button class="btn-icon btn-icon--danger" title="删除" @click="deletePostureItem(p._controllerIdx!)" v-html="svgIcons.x"></button>
                  </template>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="action-bar mt-2">
      <!-- Magician 无上电/下电命令 -->
      <template v-if="!isMagician">
        <button class="btn btn-primary" :disabled="!isConnected" @click="doPowerOn"><span class="bic" v-html="svgIcons.bolt"></span>上电</button>
        <button class="btn btn-secondary" :disabled="!isConnected" @click="doPowerOff">⏻ 下电</button>
      </template>
      <!-- 回零：Magician 支持（HOMECmd）；其余机型预留 -->
      <button v-if="supportsHome" class="btn btn-secondary" :disabled="!isConnected" @click="doHome"><span class="bic" v-html="svgIcons.home"></span>回零</button>
      <span class="action-sep" />
      <!-- Speed Slider -->
      <div class="speed-control" :class="{ 'speed-control--disabled': !isConnected }">
        <span class="speed-label">速度</span>
        <input type="range" min="1" max="100" step="1" v-model.number="speedRatio"
          class="speed-slider" :disabled="!isConnected"
          @pointerdown="isDraggingSpeed = true"
          @pointerup="onSpeedPointerUp"
          @input="onSpeedInput" />
        <span class="speed-value">{{ speedRatio }}%</span>
      </div>
      <span class="action-sep" />
      <button class="btn btn-secondary" :disabled="!isConnected" @click="doStop" title="停止运动 (Alt+Enter)"><span class="bic" v-html="svgIcons.stop"></span>停止</button>
      <button class="btn btn-danger estop-btn" :disabled="!isConnected" @click="doEstop"><span class="bic" v-html="svgIcons.warn"></span>急停</button>
      <!-- Magician 无轨迹录制 -->
      <button v-if="!isMagician" :class="['btn btn-sm', showTrajectory ? 'btn-primary' : 'btn-secondary']" @click="toggleTrajectory" :disabled="!isConnected">
        <span class="bic" v-html="svgIcons.pin"></span>轨迹
      </button>
      <!-- DobotES01 吸盘快捷控制 -->
      <template v-if="hasDobotES01">
        <span class="action-sep" />
        <div class="es01-control" :class="{ 'es01-control--busy': es01Busy }">
          <span class="es01-label">吸盘</span>
          <span :class="['es01-status', `es01-status--${es01StatusKey}`]">{{ es01StatusText }}</span>
          <button class="btn btn-primary btn-sm" :disabled="!isConnected || es01Busy" @click="doES01('grip')" title="吸取 (Z)">吸取</button>
          <button class="btn btn-secondary btn-sm" :disabled="!isConnected || es01Busy" @click="doES01('release')" title="释放 (X)">释放</button>
          <button class="btn btn-secondary btn-sm" :disabled="!isConnected || es01Busy" @click="doES01('clearAlarm')" title="清错 (C)">清错</button>
        </div>
      </template>
      <!-- Magician 末端执行器：吸盘（Z/X）+ 夹爪（V/B） -->
      <template v-if="isMagician">
        <span class="action-sep" />
        <div class="es01-control">
          <span class="es01-label">吸盘</span>
          <span :class="['es01-status', `es01-status--${magicianSuction ? 'grip' : 'release'}`]">{{ magicianSuction ? '吸附中' : '已释放' }}</span>
          <button class="btn btn-primary btn-sm" :disabled="!isConnected" @click="setMagicianSuction(true)" title="吸取 (Z)">吸取</button>
          <button class="btn btn-secondary btn-sm" :disabled="!isConnected" @click="setMagicianSuction(false)" title="释放 (X)">释放</button>
        </div>
        <div class="es01-control">
          <span class="es01-label">夹爪</span>
          <span :class="['es01-status', `es01-status--${magicianGripper ? 'grip' : 'release'}`]">{{ magicianGripper ? '抓紧中' : '已松开' }}</span>
          <button class="btn btn-primary btn-sm" :disabled="!isConnected" @click="setMagicianGripper(true)" title="抓紧 (V)">抓紧</button>
          <button class="btn btn-secondary btn-sm" :disabled="!isConnected" @click="setMagicianGripper(false)" title="松开 (B)">松开</button>
        </div>
      </template>
    </div>

    <!-- Trajectory Panel -->
    <Transition name="fade">
      <div v-if="showTrajectory" class="side-panel-overlay" @click="showTrajectory = false" />
    </Transition>
    <Transition name="logs-slide">
      <div v-if="showTrajectory" class="log-panel card" @click.stop>
        <div class="log-panel-header">
          <div class="log-panel-title">
            <span class="hud-label" style="margin-bottom:0"><span class="bic" v-html="svgIcons.pin"></span>轨迹录制 (控制器存储)</span>
            <span v-if="trajPoints.length > 0" class="preset-count-badge">{{ trajPoints.length }}</span>
          </div>
          <div class="log-panel-actions">
            <button
              v-if="trajPlayingName"
              class="btn btn-danger btn-sm"
              @click="stopTrackPlayback(trajPlayingName)"><span class="bic" v-html="svgIcons.stop"></span>停止复现</button>
            <template v-if="!trajRecording">
              <button class="btn btn-primary btn-sm" :disabled="!isConnected" @click="startTrajRecord"><span class="bic" v-html="svgIcons.record"></span>新建轨迹</button>
            </template>
            <template v-else>
              <span class="recording-indicator">● 拖拽录制中</span>
              <button class="btn btn-danger btn-sm" @click="stopTrajRecord"><span class="bic" v-html="svgIcons.stop"></span>保存</button>
            </template>
            <button class="btn btn-secondary btn-sm" @click="loadTracksList"><span class="bic" v-html="svgIcons.refresh"></span>刷新</button>
            <button class="btn btn-secondary btn-sm btn-ic" @click="showTrajectory = false" title="关闭" v-html="svgIcons.x"></button>
          </div>
        </div>
        <!-- Saved tracks on controller -->
        <div v-if="savedTracks.length > 0" class="track-list-bar">
          <span style="font-size:0.55rem;color:var(--text-muted);margin-right:6px">控制器文件:</span>
          <div v-for="t in savedTracks" :key="t.name" class="track-item">
            <button
              :class="['btn btn-sm', loadedTrackName === t.name ? 'btn-primary' : 'btn-secondary']"
              style="font-size:0.6rem;padding:2px 8px"
              @click="loadTrackPoints(t.name)" :title="`${t.size} bytes · ${t.mtime}`">
              {{ t.name }}
            </button>
            <button
              v-if="trajPlayingName === t.name"
              class="btn btn-danger btn-xs" title="停止复现"
              @click="stopTrackPlayback(t.name)">■</button>
            <button
              v-else class="btn btn-secondary btn-xs" title="轨迹复现"
              :disabled="trajPlayingName !== ''"
              @click="startTrackPlayback(t.name)">▶</button>
            <button class="track-item-action" title="重命名" @click="renameTrack(t.name)" v-html="svgIcons.pen"></button>
            <button class="track-item-action" title="删除" @click="deleteTrack(t.name)" v-html="svgIcons.trash"></button>
          </div>
        </div>
        <!-- Playback progress + params -->
        <div v-if="trajPlayingName" class="track-playback-bar">
          <span class="track-playback-text">
            ▶ 复现 {{ trajPlayingName }} · {{ trajPlaybackPercent }}% · 第 {{ trajPlaybackTimes }}/{{ retraceLoop }} 次
          </span>
          <button class="btn btn-secondary btn-xs" @click="stopTrackPlayback(trajPlayingName)"><span class="bic" v-html="svgIcons.stop"></span>停止</button>
        </div>
        <div v-else-if="savedTracks.length > 0" class="track-params-bar">
          <label class="track-param">倍率
            <select v-model.number="retraceMulti" class="preset-name-input" style="width:52px">
              <option :value="0.25">0.25</option>
              <option :value="0.5">0.5</option>
              <option :value="1">1</option>
              <option :value="2">2</option>
            </select>
          </label>
          <label class="track-param">次数
            <input v-model.number="retraceLoop" type="number" min="1" max="1000" class="preset-name-input" style="width:52px" />
          </label>
          <label class="track-param track-param--check">
            <input type="checkbox" v-model="retraceUniform" /> 匀速
          </label>
          <button class="btn btn-secondary btn-xs" @click="saveRetraceParams">保存参数</button>
        </div>
        <!-- Loaded track points -->
        <div class="log-list" style="max-height:250px">
          <div v-if="trajPoints.length === 0" class="log-empty">选择控制器上的轨迹文件加载，或开始新录制</div>
          <table v-else class="traj-table">
            <thead>
              <tr><th>#</th><th>X</th><th>Y</th><th>Z</th><th>RX</th><th>RY</th><th>RZ</th><th style="width:100px">操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="(pt, i) in trajPoints" :key="i" :class="{ 'row--moving': trajMovingIdx === i }">
                <td>{{ i + 1 }}</td>
                <td>{{ pt.x.toFixed(2) }}</td><td>{{ pt.y.toFixed(2) }}</td><td>{{ pt.z.toFixed(2) }}</td>
                <td>{{ pt.rx.toFixed(2) }}</td><td>{{ pt.ry.toFixed(2) }}</td><td>{{ pt.rz.toFixed(2) }}</td>
                <td class="table-actions">
                  <button class="btn btn-secondary btn-xs" @click="goToTrajPoint(i)" :disabled="trajMovingIdx >= 0">GO</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Transition>

    <!-- Device Log Panel -->
    <Transition name="fade">
      <div v-if="showLogs" class="side-panel-overlay" @click="showLogs = false" />
    </Transition>
    <Transition name="logs-slide">
      <div v-if="showLogs" class="log-panel card" @click.stop>
        <div class="log-panel-header">
          <div class="log-panel-title">
            <span class="hud-label" style="margin-bottom:0"><span class="bic" v-html="svgIcons.clipboard"></span>设备日志</span>
            <div class="log-tabs">
              <button :class="['log-tab', { 'log-tab--active': logPanelTab === 'alarms' }]" @click="switchLogTab('alarms')">告警</button>
              <button v-if="!isMagician" :class="['log-tab', { 'log-tab--active': logPanelTab === 'history' }]" @click="switchLogTab('history')">历史</button>
            </div>
          </div>
          <div class="log-panel-actions">
            <span class="log-count">{{ logCountText }}</span>
            <button class="btn btn-primary btn-sm" @click="refreshVisibleLogs" :disabled="logRefreshDisabled">
              {{ visibleLogLoading ? '加载中...' : '刷新' }}
            </button>
            <button class="btn btn-secondary btn-sm" @click="showLogs = false">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
        </div>

        <template v-if="logPanelTab === 'alarms'">
          <div class="log-list" ref="logListRef">
            <div v-if="deviceLogs.length === 0" class="log-empty">暂无设备日志 — 点击刷新</div>
            <div v-for="(entry, i) in deviceLogs" :key="i" :class="['log-entry', `log-entry--${entry.type}`]">
              <span class="log-time">{{ entry.date }} {{ entry.time }}</span>
              <span class="log-icon" v-html="entry.type === 'alarm' ? svgIcons.x : entry.type === 'warning' ? '!' : svgIcons.info"></span>
              <div class="log-body">
                <span class="log-title">{{ entry.type === 'alarm' ? '告警' : '警告' }} #{{ entry.id }}</span>
                <span v-if="entry.level !== ''" class="log-level">等级 {{ entry.level }}</span>
                <span class="log-desc">{{ entry.description }}</span>
                <span v-if="entry.solution" class="log-solution">{{ entry.solution }}</span>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="history-log-controls">
            <div class="history-date-row">
              <input v-model="historyLogStart" type="date" class="history-input" />
              <input v-model="historyLogEnd" type="date" class="history-input" />
            </div>
            <input v-model.trim="historyLogKeyword" type="search" class="history-input history-input--wide" placeholder="关键词" @keyup.enter="fetchControlLogs" />
            <div class="history-type-row">
              <label v-for="level in historyTypeOptions" :key="level" class="history-type-chip">
                <input v-model="historyLogTypes" type="checkbox" :value="level" />
                <span>{{ level.toUpperCase() }}</span>
              </label>
            </div>
            <div v-if="historyLogFiles.length > 0" class="history-file-summary">
              {{ historyLogFiles.length }} 个文件 · {{ historyLogFiles.map(f => f.name).join(', ') }}
            </div>
          </div>
          <div class="log-list history-log-list">
            <div v-if="historyLogEntries.length === 0" class="log-empty">暂无历史日志 — 点击刷新</div>
            <div v-for="entry in historyLogEntries" :key="`${entry.file}:${entry.line}`" :class="['log-entry', 'history-log-entry', `log-entry--${entry.level}`]">
              <span class="log-time">{{ entry.file }}:{{ entry.line }}</span>
              <span class="log-icon" v-html="historyLogIcon(entry.level)"></span>
              <div class="log-body">
                <span class="log-title">{{ entry.level.toUpperCase() }}</span>
                <span class="history-log-text">{{ entry.text }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </Transition>

    <!-- Settings Side Panel -->
    <Transition name="fade">
      <div v-if="showSettings" class="side-panel-overlay" @click="showSettings = false" />
    </Transition>
    <Transition name="logs-slide">
      <div v-if="showSettings" class="settings-panel card" @click.stop>
        <div class="log-panel-header">
          <div class="log-panel-title">
            <span class="hud-label" style="margin-bottom:0"><span class="bic" v-html="svgIcons.gear"></span>设备设置</span>
          </div>
          <div class="log-panel-actions">
            <button class="btn btn-secondary btn-sm" @click="showSettings = false">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
        </div>
        <div class="settings-layout">
          <!-- Sidebar tabs -->
          <nav class="settings-sidebar">
            <button
              v-for="tab in settingsTabs"
              :key="tab.key"
              :class="['settings-nav-item', { 'settings-nav-item--active': settingsTab === tab.key }]"
              @click="settingsTab = tab.key"
            >
              <span class="settings-nav-icon" v-html="svgIcons[tab.icon]"></span>
              <span class="settings-nav-label">{{ tab.label }}</span>
            </button>
          </nav>
          <!-- Content -->
          <div class="settings-content">

              <!-- Load Parameters -->
              <div v-if="settingsTab === 'load'">
                <!-- Current Load -->
                <div class="settings-section">
                  <div class="settings-section-header">
                    <h4>当前负载</h4>
                    <div style="display:flex;gap:6px;align-items:center">
                      <span v-if="maxLoadG" class="text-muted" style="font-size:0.68rem">机型最大负载 {{ maxLoadG }}g</span>
                      <button class="btn btn-primary btn-sm" @click="saveCurrentLoad" :disabled="!loadParamsEditable || !settingsWritable">应用</button>
                    </div>
                  </div>
                  <div class="load-fields">
                    <div class="load-field">
                      <label>名称</label>
                      <input v-model.trim="loadParamsForm.name" class="input-sm" placeholder="自定义（留空 = 自定义挡位）" />
                    </div>
                    <div class="load-field">
                      <label>重量 (g)</label>
                      <input v-model.number="loadParamsForm.loadValue" type="number" class="input-sm" step="1" min="0" />
                    </div>
                    <div class="load-field">
                      <label>质心 X (mm)</label>
                      <input v-model.number="loadParamsForm.centerX" type="number" class="input-sm" step="0.1" />
                    </div>
                    <div class="load-field">
                      <label>质心 Y (mm)</label>
                      <input v-model.number="loadParamsForm.centerY" type="number" class="input-sm" step="0.1" />
                    </div>
                    <div class="load-field">
                      <label>质心 Z (mm)</label>
                      <input v-model.number="loadParamsForm.centerZ" type="number" class="input-sm" step="0.1" />
                    </div>
                  </div>
                </div>

                <!-- Load Presets -->
                <div class="settings-section">
                  <div class="settings-section-header">
                    <h4>负载预设</h4>
                    <button class="btn btn-secondary btn-sm" @click="startAddPreset" :disabled="editingPresetIdx !== null || !settingsWritable">+ 新增</button>
                  </div>
                  <div v-if="loadConfigs.length === 0 && !addingPreset" class="text-muted" style="padding:12px 0;font-size:0.75rem;">
                    设备上暂无预设 — 请添加一个或在上方设置自定义负载
                  </div>
                  <table v-if="loadConfigs.length > 0 || addingPreset" class="load-config-table">
                    <thead>
                      <tr>
                        <th>名称</th>
                        <th>重量</th>
                        <th>X</th>
                        <th>Y</th>
                        <th>Z</th>
                        <th style="width:140px">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, i) in loadConfigs" :key="i" :class="{ 'row--editing': editingPresetIdx === i }">
                        <template v-if="editingPresetIdx === i">
                          <td><input v-model.trim="editPresetForm.name" class="input-xs" style="width:80px" /></td>
                          <td><input v-model.number="editPresetForm.loadValue" type="number" class="input-xs" style="width:60px" step="1" /></td>
                          <td><input v-model.number="editPresetForm.centerX" type="number" class="input-xs" style="width:55px" step="0.1" /></td>
                          <td><input v-model.number="editPresetForm.centerY" type="number" class="input-xs" style="width:55px" step="0.1" /></td>
                          <td><input v-model.number="editPresetForm.centerZ" type="number" class="input-xs" style="width:55px" step="0.1" /></td>
                          <td class="table-actions">
                            <button class="btn btn-primary btn-xs btn-ic" @click="saveEditPreset(i)" title="保存" v-html="svgIcons.check"></button>
                            <button class="btn btn-secondary btn-xs btn-ic" @click="cancelEditPreset" title="取消" v-html="svgIcons.x"></button>
                          </td>
                        </template>
                        <template v-else>
                          <td class="preset-name">{{ item.name }}</td>
                          <td>{{ item.loadValue }}</td>
                          <td>{{ item.centerX }}</td>
                          <td>{{ item.centerY }}</td>
                          <td>{{ item.centerZ }}</td>
                          <td class="table-actions">
                            <button class="btn btn-secondary btn-xs" @click="applyPreset(item)">使用</button>
                            <button class="btn btn-secondary btn-xs btn-ic" @click="startEditPreset(i)" title="编辑" v-html="svgIcons.pen"></button>
                            <button class="btn btn-secondary btn-xs btn-ic" @click="deletePreset(i)" title="删除" v-html="svgIcons.x"></button>
                          </td>
                        </template>
                      </tr>
                      <tr v-if="addingPreset" class="row--editing">
                        <td><input v-model.trim="addPresetForm.name" class="input-xs" style="width:80px" placeholder="名称" /></td>
                        <td><input v-model.number="addPresetForm.loadValue" type="number" class="input-xs" style="width:60px" step="1" placeholder="0" /></td>
                        <td><input v-model.number="addPresetForm.centerX" type="number" class="input-xs" style="width:55px" step="0.1" placeholder="0" /></td>
                        <td><input v-model.number="addPresetForm.centerY" type="number" class="input-xs" style="width:55px" step="0.1" placeholder="0" /></td>
                        <td><input v-model.number="addPresetForm.centerZ" type="number" class="input-xs" style="width:55px" step="0.1" placeholder="0" /></td>
                        <td>
                          <span style="display:flex;gap:4px"><button class="btn btn-primary btn-xs btn-ic" @click="confirmAddPreset" title="确认" v-html="svgIcons.check"></button>
                          <button class="btn btn-secondary btn-xs btn-ic" @click="cancelAddPreset" title="取消" v-html="svgIcons.x"></button></span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- System Settings -->
              <div v-else-if="settingsTab === 'system'">
                <div class="settings-section">
                  <div class="settings-section-header"><h4>机器人别名</h4></div>
                  <div style="display:flex;gap:8px">
                    <input v-model.trim="aliasInput" class="input-sm settings-alias-input" placeholder="机器人别名" @keyup.enter="saveAlias" :disabled="!settingsWritable" />
                    <button class="btn btn-primary btn-sm" @click="saveAlias" :disabled="!settingsWritable">保存</button>
                  </div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-header"><h4>系统时间</h4></div>
                  <div class="load-fields" style="grid-template-columns:1fr 1fr 1fr">
                    <div class="load-field"><label>日期</label><input v-model.trim="sysTimeForm.date" class="input-sm" placeholder="YYYY-MM-DD" :disabled="!settingsWritable" /></div>
                    <div class="load-field"><label>时间</label><input v-model.trim="sysTimeForm.time" class="input-sm" placeholder="HH:mm:ss" :disabled="!settingsWritable" /></div>
                    <div class="load-field"><label>时区</label><input v-model.trim="sysTimeForm.timeZone" class="input-sm" placeholder="Asia/Shanghai" :disabled="!settingsWritable" /></div>
                  </div>
                  <div style="display:flex;gap:8px" class="mt-2">
                    <button class="btn btn-primary btn-sm" @click="saveSystemTime" :disabled="!settingsWritable">应用</button>
                    <button class="btn btn-secondary btn-sm" @click="syncLocalTime" :disabled="!settingsWritable">同步当前时间</button>
                  </div>
                </div>
              </div>

              <!-- User Management -->
              <div v-else-if="settingsTab === 'users'">
                <div class="settings-section">
                  <div class="settings-section-header">
                    <h4>用户</h4>
                    <button class="btn btn-secondary btn-sm" @click="startAddUser" :disabled="!settingsWritable">+ 新增</button>
                  </div>
                  <table class="load-config-table" v-if="ctrlUserList.list.length > 0">
                    <thead><tr><th>名称</th><th>密码</th><th>需密码</th><th style="width:80px">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="(u, i) in ctrlUserList.list" :key="i" :class="{ 'row--editing': editingUserIdx === i }">
                        <template v-if="editingUserIdx === i">
                          <td style="display:flex;gap:4px;align-items:center">
                            <template v-if="isFixedLevel(u.level)">
                              <span class="preset-name">{{ levelName(u.level) }}</span>
                            </template>
                            <template v-else>
                              <select v-model.number="editUserForm.level" class="input-xs" style="width:85px">
                                <option :value="0">默认</option><option :value="1">管理员</option><option :value="2">技术员</option><option :value="3">操作员</option>
                              </select>
                              <input v-model.trim="editUserForm.name" class="input-xs" style="width:70px" placeholder="名称" />
                            </template>
                          </td>
                          <td><input v-model.trim="editUserForm.password" class="input-xs" style="width:80px" /></td>
                          <td><label class="checkbox-xs"><input v-model="editUserForm.enablePassword" type="checkbox" /><span>需密码</span></label></td>
                          <td class="table-actions">
                            <button class="btn btn-primary btn-xs btn-ic" @click="saveEditUser(i)" title="保存" v-html="svgIcons.check"></button>
                            <button class="btn btn-secondary btn-xs btn-ic" @click="editingUserIdx = null" title="取消" v-html="svgIcons.x"></button>
                          </td>
                        </template>
                        <template v-else>
                          <td class="preset-name">{{ isFixedLevel(u.level) ? levelName(u.level) : (u.name || ('等级' + u.level)) }}</td>
                          <td>{{ u.enablePassword ? '●●●●' : '(无)' }}</td>
                          <td><span v-html="u.enablePassword ? svgIcons.check : '—'"></span></td>
                          <td class="table-actions">
                            <button class="btn btn-secondary btn-xs btn-ic" @click="startEditUser(i)" title="编辑" v-html="svgIcons.pen"></button>
                            <button class="btn btn-secondary btn-xs btn-ic" @click="deleteUser(i)" title="删除" v-html="svgIcons.x"></button>
                          </td>
                        </template>
                      </tr>
                      <tr v-if="addingUser" class="row--editing">
                        <td><input v-model.trim="addUserForm.name" class="input-xs" style="width:100px" placeholder="名称" /></td>
                        <td><input v-model.trim="addUserForm.password" class="input-xs" style="width:80px" placeholder="密码" /></td>
                        <td><label class="checkbox-xs"><input v-model="addUserForm.enablePassword" type="checkbox" /><span>需密码</span></label></td>
                        <td class="table-actions">
                          <button class="btn btn-primary btn-xs btn-ic" @click="confirmAddUser" title="确认" v-html="svgIcons.check"></button>
                          <button class="btn btn-secondary btn-xs btn-ic" @click="addingUser = false" title="取消" v-html="svgIcons.x"></button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-muted" style="padding:12px 0;font-size:0.75rem">控制器上暂无用户</div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-header"><h4>权限</h4></div>
                  <div v-if="permConfigs.length > 0" style="overflow-x:auto">
                    <table class="load-config-table" style="min-width:700px">
                      <thead><tr><th>等级</th><th v-for="k in permKeys" :key="k" style="font-size:0.42rem;writing-mode:vertical-lr;text-orientation:mixed;height:90px;padding:2px">{{ permKeyLabels[k] || k }}</th></tr></thead>
                      <tbody>
                        <tr v-for="pc in permConfigs" :key="pc.level">
                          <td>{{ userDisplayName(pc.level) }}</td>
                          <td v-for="k in permKeys" :key="k"><input type="checkbox" :checked="pc.config[k] === 1" @change="togglePerm(pc.level, k, ($event.target as HTMLInputElement).checked)" /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <button class="btn btn-primary btn-sm mt-2" @click="savePermissions" :disabled="!settingsWritable">保存权限</button>
                </div>
              </div>

              <!-- Coordinate Management -->
              <div v-else-if="settingsTab === 'coordinates'">
                <div class="settings-section">
                  <div class="settings-section-header"><h4>工具坐标系</h4><button class="btn btn-secondary btn-sm" @click="startAddCoord('tool')" :disabled="!settingsWritable">+ 添加</button></div>
                  <table class="load-config-table" v-if="toolCoords.length > 0">
                    <thead><tr><th style="width:34px">ID</th><th>名称</th><th>X</th><th>Y</th><th>Z</th><th>RX</th><th>RY</th><th>RZ</th><th style="width:46px">启用</th><th style="width:80px">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="(c, i) in toolCoords" :key="i" :class="{ 'row--editing': editingCoordIdx === i && editingCoordType === 'tool' }">
                        <template v-if="editingCoordIdx === i && editingCoordType === 'tool'">
                          <td class="preset-name">{{ editCoordForm.id }}</td>
                          <td><input v-model.trim="editCoordForm.alias" class="input-xs" style="width:70px" /></td>
                          <td><input v-model.number="editCoordForm.x" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.y" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.z" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.rx" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.ry" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.rz" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><label class="checkbox-xs"><input v-model="editCoordForm.enable" type="checkbox" /></label></td>
                          <td class="table-actions"><button class="btn btn-primary btn-xs btn-ic" @click="saveEditCoord" title="保存" v-html="svgIcons.check"></button><button class="btn btn-secondary btn-xs btn-ic" @click="editingCoordIdx = -1" title="取消" v-html="svgIcons.x"></button></td>
                        </template>
                        <template v-else>
                          <td class="preset-name">{{ c.id }}</td><td class="preset-name">{{ c.alias }}</td>
                          <td>{{ c.x }}</td><td>{{ c.y }}</td><td>{{ c.z }}</td>
                          <td>{{ c.rx }}</td><td>{{ c.ry }}</td><td>{{ c.rz }}</td>
                          <td><span v-html="c.enable ? svgIcons.check : '—'"></span></td>
                          <td class="table-actions"><button class="btn btn-secondary btn-xs btn-ic" @click="startEditCoord('tool', i)" title="编辑" v-html="svgIcons.pen"></button><button class="btn btn-secondary btn-xs btn-ic" @click="deleteCoord('tool', i)" title="删除" v-html="svgIcons.x"></button></td>
                        </template>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-muted" style="padding:8px 0;font-size:0.7rem">暂无工具坐标系</div>
                  <button class="btn btn-primary btn-sm mt-2" :disabled="toolCoords.length === 0 || !settingsWritable" @click="saveCoords('tool')">保存</button>
                  <div v-if="addingCoord && addCoordType === 'tool'" class="coord-add-row">
                    <input v-model.trim="addCoordForm.alias" class="input-xs" style="width:100px" placeholder="名称" />
                    <input v-model.number="addCoordForm.x" type="number" class="input-xs" style="width:55px" placeholder="x" step="0.1" />
                    <input v-model.number="addCoordForm.y" type="number" class="input-xs" style="width:55px" placeholder="y" step="0.1" />
                    <input v-model.number="addCoordForm.z" type="number" class="input-xs" style="width:55px" placeholder="z" step="0.1" />
                    <input v-model.number="addCoordForm.rx" type="number" class="input-xs" style="width:55px" placeholder="rx" step="0.1" />
                    <input v-model.number="addCoordForm.ry" type="number" class="input-xs" style="width:55px" placeholder="ry" step="0.1" />
                    <input v-model.number="addCoordForm.rz" type="number" class="input-xs" style="width:55px" placeholder="rz" step="0.1" />
                    <span style="display:flex;gap:4px"><button class="btn btn-primary btn-xs btn-ic" @click="confirmAddCoord" title="确认" v-html="svgIcons.check"></button>
                    <button class="btn btn-secondary btn-xs btn-ic" @click="addingCoord = false" title="取消" v-html="svgIcons.x"></button></span>
                  </div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-header"><h4>用户坐标系</h4><button class="btn btn-secondary btn-sm" @click="startAddCoord('user')" :disabled="!settingsWritable">+ 添加</button></div>
                  <table class="load-config-table" v-if="userCoords.length > 0">
                    <thead><tr><th style="width:34px">ID</th><th>名称</th><th>X</th><th>Y</th><th>Z</th><th>RX</th><th>RY</th><th>RZ</th><th style="width:46px">启用</th><th style="width:80px">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="(c, i) in userCoords" :key="i" :class="{ 'row--editing': editingCoordIdx === i && editingCoordType === 'user' }">
                        <template v-if="editingCoordIdx === i && editingCoordType === 'user'">
                          <td class="preset-name">{{ editCoordForm.id }}</td>
                          <td><input v-model.trim="editCoordForm.alias" class="input-xs" style="width:70px" /></td>
                          <td><input v-model.number="editCoordForm.x" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.y" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.z" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.rx" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.ry" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><input v-model.number="editCoordForm.rz" type="number" class="input-xs" style="width:50px" step="0.1" /></td>
                          <td><label class="checkbox-xs"><input v-model="editCoordForm.enable" type="checkbox" /></label></td>
                          <td class="table-actions"><button class="btn btn-primary btn-xs btn-ic" @click="saveEditCoord" title="保存" v-html="svgIcons.check"></button><button class="btn btn-secondary btn-xs btn-ic" @click="editingCoordIdx = -1" title="取消" v-html="svgIcons.x"></button></td>
                        </template>
                        <template v-else>
                          <td class="preset-name">{{ c.id }}</td><td class="preset-name">{{ c.alias }}</td>
                          <td>{{ c.x }}</td><td>{{ c.y }}</td><td>{{ c.z }}</td>
                          <td>{{ c.rx }}</td><td>{{ c.ry }}</td><td>{{ c.rz }}</td>
                          <td><span v-html="c.enable ? svgIcons.check : '—'"></span></td>
                          <td class="table-actions"><button class="btn btn-secondary btn-xs btn-ic" @click="startEditCoord('user', i)" title="编辑" v-html="svgIcons.pen"></button><button class="btn btn-secondary btn-xs btn-ic" @click="deleteCoord('user', i)" title="删除" v-html="svgIcons.x"></button></td>
                        </template>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-muted" style="padding:8px 0;font-size:0.7rem">暂无用户坐标系</div>
                  <button class="btn btn-primary btn-sm mt-2" :disabled="userCoords.length === 0 || !settingsWritable" @click="saveCoords('user')">保存</button>
                  <div v-if="addingCoord && addCoordType === 'user'" class="coord-add-row">
                    <input v-model.trim="addCoordForm.alias" class="input-xs" style="width:100px" placeholder="名称" />
                    <input v-model.number="addCoordForm.x" type="number" class="input-xs" style="width:55px" placeholder="x" step="0.1" />
                    <input v-model.number="addCoordForm.y" type="number" class="input-xs" style="width:55px" placeholder="y" step="0.1" />
                    <input v-model.number="addCoordForm.z" type="number" class="input-xs" style="width:55px" placeholder="z" step="0.1" />
                    <input v-model.number="addCoordForm.rx" type="number" class="input-xs" style="width:55px" placeholder="rx" step="0.1" />
                    <input v-model.number="addCoordForm.ry" type="number" class="input-xs" style="width:55px" placeholder="ry" step="0.1" />
                    <input v-model.number="addCoordForm.rz" type="number" class="input-xs" style="width:55px" placeholder="rz" step="0.1" />
                    <span style="display:flex;gap:4px"><button class="btn btn-primary btn-xs btn-ic" @click="confirmAddCoord" title="确认" v-html="svgIcons.check"></button>
                    <button class="btn btn-secondary btn-xs btn-ic" @click="addingCoord = false" title="取消" v-html="svgIcons.x"></button></span>
                  </div>
                </div>
              </div>

              <!-- Custom Postures -->
              <div v-else-if="settingsTab === 'postures'">
                <div class="settings-section">
                  <div class="settings-section-header">
                    <h4>自定义预设</h4>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button class="btn btn-secondary btn-sm" @click="addPostureFromCurrent('joint')" :disabled="!isConnected || !settingsWritable"><span class="bic" v-html="svgIcons.clipboard"></span>当前关节角</button>
                      <button class="btn btn-secondary btn-sm" @click="addPostureFromCurrent('cartesian')" :disabled="!isConnected || !settingsWritable"><span class="bic" v-html="svgIcons.clipboard"></span>当前位姿</button>
                      <button class="btn btn-secondary btn-sm" @click="addEmptyPosture('joint')" :disabled="!settingsWritable">+ 关节角</button>
                      <button class="btn btn-secondary btn-sm" @click="addEmptyPosture('cartesian')" :disabled="!settingsWritable">+ 位姿</button>
                    </div>
                  </div>
                  <div v-if="customPostures.length === 0" class="text-muted" style="padding:12px 0;font-size:0.75rem">暂无自定义预设</div>
                  <table v-if="customPostures.length > 0" class="load-config-table">
                    <thead>
                      <tr>
                        <th style="width:40px">#</th>
                        <th style="width:70px">类型</th>
                        <th>名称</th>
                        <th>数值</th>
                        <th style="width:120px">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(p, i) in customPostures" :key="i" :class="{ 'row--editing': editingPostureIdx === i }">
                        <template v-if="editingPostureIdx === i">
                          <td class="preset-name">{{ i + 1 }}</td>
                          <td>
                            <select v-model="editPostureForm.type" class="input-xs" style="width:72px">
                              <option value="joint">关节角</option>
                              <option value="cartesian">位姿</option>
                            </select>
                          </td>
                          <td><input v-model.trim="editPostureForm.name" class="input-xs" style="width:80px" /></td>
                          <td>
                            <div v-if="editPostureForm.type === 'cartesian'" style="display:flex;gap:3px;flex-wrap:wrap">
                              <input v-for="axis in poseAxes" :key="axis"
                                v-model.number="editPostureForm.pose![axis === 'r' ? 'rx' : axis]" type="number" class="input-xs"
                                style="width:58px" step="0.1" :title="axis.toUpperCase()" :placeholder="axis.toUpperCase()" />
                            </div>
                            <div v-else style="display:flex;gap:3px;flex-wrap:wrap">
                              <input v-for="j in jointCount" :key="j" v-model.number="editPostureForm.joint[j-1]"
                                type="number" class="input-xs" style="width:58px" step="0.1" :placeholder="'J' + j" />
                            </div>
                          </td>
                          <td class="table-actions">
                            <button class="btn btn-primary btn-xs btn-ic" @click="saveEditPosture(i)" title="保存" v-html="svgIcons.check"></button>
                            <button class="btn btn-secondary btn-xs btn-ic" @click="editingPostureIdx = null" title="取消" v-html="svgIcons.x"></button>
                          </td>
                        </template>
                        <template v-else>
                          <td class="preset-name">{{ i + 1 }}</td>
                          <td>{{ (p.type === 'cartesian') ? '位姿' : '关节角' }}</td>
                          <td class="preset-name">{{ p.name }}</td>
                          <td style="font-size:0.66rem">{{ formatPostureSummary(p) }}</td>
                          <td class="table-actions">
                            <button class="btn btn-secondary btn-xs" @click="fillPosture(p)">填充</button>
                            <button class="btn btn-secondary btn-xs btn-ic" @click="startEditPosture(i)" :disabled="moving" title="编辑" v-html="svgIcons.pen"></button>
                            <button class="btn btn-secondary btn-xs btn-ic" @click="deletePosture(i)" :disabled="moving" title="删除" v-html="svgIcons.x"></button>
                          </td>
                        </template>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Motion Parameters -->
              <div v-else-if="settingsTab === 'motion'">
                <div v-for="grp in motionGroupsList" :key="grp.key" class="settings-section">
                  <div class="settings-section-header">
                    <h4>{{ grp.label }}</h4>
                    <div style="display:flex;gap:6px;align-items:center">
                      <span v-if="grp.loading" class="text-muted" style="font-size:0.7rem">加载中...</span>
                      <button class="btn btn-secondary btn-sm" @click="loadMotionGroup(grp.key)">读取</button>
                      <button class="btn btn-secondary btn-sm" :disabled="!grp.loaded || !settingsWritable" @click="resetMotionGroup(grp.key)">恢复默认值</button>
                      <button class="btn btn-primary btn-sm" :disabled="!grp.loaded || !settingsWritable || grp.saving" @click="saveMotionGroup(grp.key)">
                        {{ grp.saving ? '保存中...' : '保存' }}
                      </button>
                    </div>
                  </div>
                  <table class="load-config-table motion-table">
                    <thead>
                      <tr>
                        <th style="width:70px">轴</th>
                        <th>速度</th>
                        <th>加速度</th>
                        <th v-if="grp.showJerk">加加速度</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in grp.rows" :key="row.label">
                        <td class="preset-name">{{ row.label }}</td>
                        <td>
                          <div class="motion-cell">
                            <input v-model.number="row.velocity" type="number" class="input-xs motion-input" min="0" step="1" :disabled="!settingsWritable" />
                            <span class="motion-unit">{{ row.suffixVel }}</span>
                          </div>
                        </td>
                        <td>
                          <div class="motion-cell">
                            <input v-model.number="row.acceleration" type="number" class="input-xs motion-input" min="0" step="1" :disabled="!settingsWritable" />
                            <span class="motion-unit">{{ row.suffixAcc }}</span>
                          </div>
                        </td>
                        <td v-if="grp.showJerk">
                          <div class="motion-cell">
                            <input v-model.number="row.jerk" type="number" class="input-xs motion-input" min="0" step="1" :disabled="!settingsWritable" />
                            <span class="motion-unit">{{ row.suffixJerk }}</span>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-if="grp.loadError" class="text-danger" style="padding:6px 0;font-size:0.72rem">读取失败：{{ grp.loadError }}</div>
                </div>
              </div>

              <!-- Communication -->
              <div v-else-if="settingsTab === 'comm'">
                <!-- WiFi -->
                <div class="settings-section">
                  <div class="settings-section-header"><h4>WiFi (AP)</h4></div>
                  <div class="load-fields" style="grid-template-columns:1fr 1fr 1fr">
                    <div class="load-field"><label>SSID</label><input v-model.trim="wifiForm.ssid" class="input-sm" :disabled="!settingsWritable || !wifiForm.enable" /></div>
                    <div class="load-field"><label>密码</label><input v-model.trim="wifiForm.passWd" class="input-sm" :disabled="!settingsWritable || !wifiForm.enable" /></div>
                    <div class="load-field" style="justify-content:flex-end"><label class="checkbox-xs" style="margin-top:18px"><input v-model="wifiForm.enable" type="checkbox" :disabled="!settingsWritable" /><span>启用</span></label></div>
                  </div>
                  <div style="display:flex;gap:6px;margin-top:8px">
                    <button class="btn btn-primary btn-sm" @click="loadWiFi">读取</button>
                    <button class="btn btn-secondary btn-sm" @click="saveWiFi" :disabled="!settingsWritable">保存</button>
                  </div>
                </div>
                <!-- Ethernet -->
                <div class="settings-section">
                  <div class="settings-section-header"><h4>以太网 (IP)</h4></div>
                  <div class="load-fields" style="grid-template-columns:1fr 1fr 1fr">
                    <div class="load-field"><label>DHCP</label><label class="checkbox-xs" style="margin-top:2px"><input v-model="ethForm.dhcp" type="checkbox" :disabled="!settingsWritable" /><span>启用</span></label></div>
                    <div class="load-field"><label>IP</label><input v-model.trim="ethForm.ip" class="input-sm" :disabled="ethForm.dhcp || !settingsWritable" /></div>
                    <div class="load-field"><label>子网掩码</label><input v-model.trim="ethForm.mask" class="input-sm" :disabled="ethForm.dhcp || !settingsWritable" /></div>
                    <div class="load-field"><label>网关</label><input v-model.trim="ethForm.gateway" class="input-sm" :disabled="ethForm.dhcp || !settingsWritable" /></div>
                  </div>
                  <div style="display:flex;gap:6px;margin-top:8px">
                    <button class="btn btn-primary btn-sm" @click="loadEthernet">读取</button>
                    <button class="btn btn-secondary btn-sm" @click="saveEthernet" :disabled="!settingsWritable">保存</button>
                  </div>
                </div>
                <!-- Bus -->
                <div class="settings-section">
                  <div class="settings-section-header"><h4>总线</h4></div>
                  <div class="load-fields" style="grid-template-columns:1fr 1fr 1fr">
                    <div class="load-field"><label>波特率</label><input v-model.number="busForm.baudRate" type="number" class="input-sm" :disabled="!settingsWritable" /></div>
                    <div class="load-field"><label>从站 ID</label><input v-model.number="busForm.slaveId" type="number" class="input-sm" :disabled="!settingsWritable" /></div>
                    <div class="load-field"><label>类型</label><input v-model.trim="busForm.type" class="input-sm" :disabled="!settingsWritable" /></div>
                    <div class="load-field"><label>数据位</label><input v-model.number="busForm.dataBits" type="number" class="input-sm" :disabled="!settingsWritable" /></div>
                    <div class="load-field"><label>停止位</label><input v-model.number="busForm.stopBits" type="number" class="input-sm" step="0.5" :disabled="!settingsWritable" /></div>
                    <div class="load-field"><label>校验位</label><input v-model.trim="busForm.parity" class="input-sm" :disabled="!settingsWritable" /></div>
                  </div>
                  <div style="display:flex;gap:6px;margin-top:8px">
                    <button class="btn btn-primary btn-sm" @click="loadBus">读取</button>
                    <button class="btn btn-secondary btn-sm" @click="saveBus" :disabled="!settingsWritable">保存</button>
                  </div>
                </div>
              </div>

              <!-- Key Settings (底座按键) -->
              <div v-else-if="settingsTab === 'key'">
                <div class="settings-section">
                  <div class="settings-section-header"><h4>底座按键模式</h4></div>
                  <div class="jog-mode-selector" style="justify-content:flex-start">
                    <button
                      :class="['jog-mode-btn', { 'jog-mode-btn--active': buttonModeForm.mode === 'playback' }]"
                      :disabled="!settingsWritable"
                      @click="buttonModeForm.mode = 'playback'"
                    >复现轨迹</button>
                    <button
                      :class="['jog-mode-btn', { 'jog-mode-btn--active': buttonModeForm.mode === 'project' }]"
                      :disabled="!settingsWritable"
                      @click="buttonModeForm.mode = 'project'"
                    >运行工程</button>
                  </div>
                  <div v-if="buttonModeForm.mode === 'project'" style="display:flex;gap:8px;margin-top:8px;align-items:center">
                    <select v-model="buttonModeForm.projectName" class="input-sm settings-alias-input" :disabled="!settingsWritable">
                      <option value="" disabled>选择工程</option>
                      <option v-for="p in buttonProjects" :key="p" :value="p">{{ p }}</option>
                    </select>
                    <button class="btn btn-secondary btn-sm" @click="loadButtonProjects" :disabled="loadingButtonProjects"><span class="bic" v-html="svgIcons.refresh"></span>工程列表</button>
                  </div>
                  <div class="text-muted" style="margin-top:8px;font-size:0.7rem;line-height:1.6">
                    E6 底座按键功能：按下底座按键时复现所选轨迹，或运行指定工程。
                  </div>
                  <div style="display:flex;gap:6px;margin-top:8px">
                    <button class="btn btn-primary btn-sm" @click="loadButtonMode">读取</button>
                    <button class="btn btn-secondary btn-sm" :disabled="!settingsWritable || (buttonModeForm.mode === 'project' && !buttonModeForm.projectName)" @click="saveButtonMode">保存</button>
                  </div>
                </div>
              </div>

              <!-- Power Setting (刹车电压) -->
              <div v-else-if="settingsTab === 'power'">
                <div class="settings-section">
                  <div class="settings-section-header"><h4>控制柜刹车电压</h4></div>
                  <div class="load-fields" style="grid-template-columns:1fr 1fr">
                    <div class="load-field"><label>最低电压 (V)</label><input v-model.number="ccboxForm.min" type="number" class="input-sm" min="30" max="60" step="1" :disabled="!settingsWritable" /></div>
                    <div class="load-field"><label>最高电压 (V)</label><input v-model.number="ccboxForm.max" type="number" class="input-sm" min="30" max="60" step="1" :disabled="!settingsWritable" /></div>
                  </div>
                  <div class="text-muted" style="margin-top:6px;font-size:0.7rem">范围 30 ~ 60V；恢复默认将设置 {0, 0}（由控制器按出厂自动判断）。</div>
                  <div style="display:flex;gap:6px;margin-top:8px">
                    <button class="btn btn-primary btn-sm" @click="loadCCBoxVoltage">读取</button>
                    <button class="btn btn-secondary btn-sm" :disabled="!settingsWritable" @click="resetCCBoxVoltage">恢复默认</button>
                    <button class="btn btn-secondary btn-sm" :disabled="!settingsWritable" @click="saveCCBoxVoltage">保存</button>
                  </div>
                </div>
              </div>

              <!-- Remote Control (IO / Modbus) -->
              <div v-else-if="settingsTab === 'remote'">
                <div class="settings-section">
                  <div class="log-tabs" style="margin-bottom:10px">
                    <button :class="['log-tab', { 'log-tab--active': remoteTab === 'io' }]" @click="remoteTab = 'io'">IO</button>
                    <button :class="['log-tab', { 'log-tab--active': remoteTab === 'modbus' }]" @click="remoteTab = 'modbus'">Modbus</button>
                  </div>

                  <template v-if="remoteTab === 'io'">
                    <div class="settings-section-header">
                      <h4>IO 远程控制</h4>
                      <div style="display:flex;gap:6px">
                        <button class="btn btn-primary btn-sm" @click="loadRemoteIO">读取</button>
                        <button class="btn btn-secondary btn-sm" :disabled="!settingsWritable || !ioCtrlRaw" @click="saveRemoteIO">保存</button>
                      </div>
                    </div>

                    <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap">
                      <span class="amp-limit-label">工程模式</span>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': ioCtrlForm.optionProject.type === 0 }]" :disabled="!settingsWritable" @click="ioCtrlForm.optionProject.type = 0">默认运行工程</button>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': ioCtrlForm.optionProject.type === 1 }]" :disabled="!settingsWritable" @click="ioCtrlForm.optionProject.type = 1">组IO选择工程</button>
                    </div>

                    <div v-if="ioCtrlForm.optionProject.type === 0" class="remote-field" style="margin-top:10px">
                      <label>默认运行工程</label>
                      <select v-model="ioCtrlForm.optionProject.defaultProject" class="input-sm settings-alias-input" :disabled="!settingsWritable">
                        <option value="" disabled>选择工程</option>
                        <option v-for="p in buttonProjects" :key="p" :value="p">{{ p }}</option>
                      </select>
                    </div>

                    <div v-else class="di-group-section" style="margin-top:10px">
                      <div class="di-group-header">
                        <span class="amp-limit-label">DI地址分配</span>
                        <button class="btn btn-secondary btn-xs" title="添加一组" :disabled="!settingsWritable || ioDiGroup.length >= 4" @click="ioDiAddGroup">十</button>
                        <button class="btn btn-secondary btn-xs" title="删除一组" :disabled="!settingsWritable || ioDiGroup.length === 0" @click="ioDiRemoveGroup">一</button>
                      </div>
                      <table class="load-config-table">
                        <thead><tr><th style="width:110px">组IO数值</th><th>选择工程</th></tr></thead>
                        <tbody>
                          <tr v-for="(row, i) in ioDiProjects" :key="row.value">
                            <td>{{ row.value }}</td>
                            <td>
                              <select v-model="ioDiProjects[i].name" class="input-xs" style="width:170px" :disabled="!settingsWritable">
                                <option value="">—</option>
                                <option v-for="p in buttonProjects" :key="p" :value="p">{{ p }}</option>
                              </select>
                            </td>
                          </tr>
                          <tr v-if="ioDiProjects.length === 0">
                            <td colspan="2" class="text-muted" style="text-align:center;padding:10px 0">暂无数据</td>
                          </tr>
                        </tbody>
                      </table>
                      <div class="text-muted" style="margin-top:4px;font-size:0.68rem">每添加一组 DI，可组合的数值翻倍（2ⁿ 个）；数值相同的组 IO 触发对应工程。</div>
                    </div>

                    <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
                      <span class="amp-limit-label">触发模式</span>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': ioCtrlForm.triggerMode === 1 }]" :disabled="!settingsWritable" @click="ioCtrlForm.triggerMode = 1">上升沿</button>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': ioCtrlForm.triggerMode === 2 }]" :disabled="!settingsWritable" @click="ioCtrlForm.triggerMode = 2">下降沿</button>
                    </div>
                  </template>

                  <template v-else>
                    <div class="settings-section-header">
                      <h4>Modbus 远程控制</h4>
                      <div style="display:flex;gap:6px">
                        <button class="btn btn-primary btn-sm" @click="loadRemoteModbus">读取</button>
                        <button class="btn btn-secondary btn-sm" :disabled="!settingsWritable || !modbusRaw" @click="saveRemoteModbus">保存</button>
                      </div>
                    </div>

                    <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap">
                      <span class="amp-limit-label">触发模式</span>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': modbusForm.triggerMode === 1 }]" :disabled="!settingsWritable" @click="modbusForm.triggerMode = 1">上升沿</button>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': modbusForm.triggerMode === 2 }]" :disabled="!settingsWritable" @click="modbusForm.triggerMode = 2">下降沿</button>
                    </div>

                    <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
                      <span class="amp-limit-label">选择工程</span>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': modbusForm.holdType === 0 }]" :disabled="!settingsWritable" @click="modbusForm.holdType = 0">默认运行工程</button>
                      <button :class="['jog-mode-btn', { 'jog-mode-btn--active': modbusForm.holdType === 1 }]" :disabled="!settingsWritable" @click="modbusForm.holdType = 1">保持寄存器选择工程</button>
                    </div>

                    <div v-if="modbusForm.holdType === 0" class="remote-field" style="margin-top:10px">
                      <label>默认运行工程</label>
                      <select v-model="modbusForm.holdDefaultProject" class="input-sm settings-alias-input" :disabled="!settingsWritable">
                        <option value="" disabled>选择工程</option>
                        <option v-for="p in buttonProjects" :key="p" :value="p">{{ p }}</option>
                      </select>
                    </div>

                    <div v-else class="di-group-section" style="margin-top:10px">
                      <div class="remote-field">
                        <label>寄存器数值</label>
                        <input v-model.number="modbusHoldOption" type="number" class="input-sm" style="width:120px" min="0" step="1" :disabled="!settingsWritable" />
                      </div>
                      <div class="di-group-header">
                        <span class="amp-limit-label">备选工程</span>
                        <button class="btn btn-secondary btn-xs" title="添加一项" :disabled="!settingsWritable || modbusHoldProjects.length >= 256" @click="modbusHoldAddProject">十</button>
                        <button class="btn btn-secondary btn-xs" title="删除一项" :disabled="!settingsWritable || modbusHoldProjects.length === 0" @click="modbusHoldRemoveProject">一</button>
                      </div>
                      <table class="load-config-table">
                        <thead><tr><th style="width:110px">寄存器数值</th><th>选择工程</th></tr></thead>
                        <tbody>
                          <tr v-for="(row, i) in modbusHoldProjects" :key="row.value">
                            <td>{{ row.value }}</td>
                            <td>
                              <select v-model="modbusHoldProjects[i].name" class="input-xs" style="width:170px" :disabled="!settingsWritable">
                                <option value="">—</option>
                                <option v-for="p in buttonProjects" :key="p" :value="p">{{ p }}</option>
                              </select>
                            </td>
                          </tr>
                          <tr v-if="modbusHoldProjects.length === 0">
                            <td colspan="2" class="text-muted" style="text-align:center;padding:10px 0">暂无数据</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </template>
                </div>
              </div>

              <!-- Drag Setting (拖动灵敏度) -->
              <div v-else-if="settingsTab === 'drag'">
                <div class="settings-section">
                  <div class="settings-section-header"><h4>拖动灵敏度</h4></div>
                  <div class="drag-grid">
                    <div v-for="j in 6" :key="j" class="drag-item">
                      <span class="drag-label">J{{ j }}</span>
                      <input v-model.number="dragForm['j' + j]" type="range" min="30" max="70" step="1" class="speed-slider" :disabled="!settingsWritable" />
                      <span class="drag-value">{{ dragForm['j' + j] }}</span>
                    </div>
                  </div>
                  <div class="text-muted" style="margin-top:6px;font-size:0.7rem">范围 30 ~ 70，数值越大拖动越灵敏。</div>
                  <div style="display:flex;gap:6px;margin-top:8px">
                    <button class="btn btn-primary btn-sm" @click="loadDragSensivity">读取</button>
                    <button class="btn btn-secondary btn-sm" :disabled="!settingsWritable" @click="saveDragSensivity">保存</button>
                  </div>
                </div>
              </div>

              <!-- Dobot+ -->
              <div v-else-if="settingsTab === 'dobotplus'">
                <!-- ES01 吸盘 -->
                <div v-if="hasDobotES01" class="settings-section">
                  <div class="settings-section-header">
                    <h4>DobotES01 吸盘</h4>
                    <span :class="['es01-status', `es01-status--${es01StatusKey}`]">{{ es01StatusText }}</span>
                  </div>
                  <div class="es01-settings-actions">
                    <button class="btn btn-primary btn-sm" :disabled="!isConnected || es01Busy" @click="doES01('grip')" title="吸取 (Z)">吸取</button>
                    <button class="btn btn-secondary btn-sm" :disabled="!isConnected || es01Busy" @click="doES01('release')" title="释放 (X)">释放</button>
                    <button class="btn btn-secondary btn-sm" :disabled="!isConnected || es01Busy" @click="doES01('clearAlarm')" title="清错 (C)">清错</button>
                    <button class="btn btn-secondary btn-sm" :disabled="!isConnected || es01Busy" @click="refreshES01Status">刷新状态</button>
                  </div>
                  <div class="text-muted" style="margin-top:8px;font-size:0.68rem">
                    通过 ToolDO(1) 控制吸/放，ToolDO(2) 脉冲清错；状态来自 ToolDI。
                  </div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-header">
                    <h4>已安装插件</h4>
                    <button class="btn btn-secondary btn-sm" @click="loadDobotPlusList" :disabled="loadingDobotPlus"><span class="bic" v-html="svgIcons.refresh"></span>刷新</button>
                  </div>
                  <div v-if="loadingDobotPlus" class="text-muted" style="padding:8px 0;font-size:0.7rem">加载中...</div>
                  <table v-else-if="dobotPlusList.length > 0" class="load-config-table">
                    <thead><tr><th>名称</th><th>端口</th><th style="width:80px">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="(name, i) in dobotPlusList" :key="i">
                        <td class="preset-name" :title="dobotPlusDescription(name) || name">{{ name }}</td>
                        <td>{{ dobotPlusPorts[name] || '—' }}</td>
                        <td class="table-actions">
                          <button v-if="dobotPlusPorts[name]" class="btn btn-secondary btn-xs" @click="selectDobotPlusPlugin(name)">打开</button>
                          <button class="btn btn-secondary btn-xs btn-ic" :disabled="!settingsWritable" @click="uninstallDobotPlusPlugin(name)" title="卸载" v-html="svgIcons.x"></button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-muted" style="padding:12px 0;font-size:0.75rem">暂无已安装插件</div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-header">
                    <h4>可安装插件</h4>
                    <button class="btn btn-secondary btn-sm" @click="refreshDobotPlusSources" :disabled="loadingDobotPlusCatalog || loadingDobotPlusLocal"><span class="bic" v-html="svgIcons.refresh"></span>刷新</button>
                  </div>
                  <div v-if="loadingDobotPlusCatalog" class="text-muted" style="padding:8px 0;font-size:0.7rem">加载中...</div>
                  <table v-else-if="installableDobotPlus.length > 0" class="load-config-table">
                    <thead><tr><th>名称</th><th style="width:90px">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="(item, i) in installableDobotPlus" :key="i">
                        <td class="preset-name" :title="item.description || item.name">
                          {{ item.name }}
                          <span v-if="item.local && !item.controller" class="text-muted" style="font-weight:400">· 本地</span>
                          <span v-if="item.local && item.controller" class="text-muted" style="font-weight:400">· 本地+控制器</span>
                        </td>
                        <td class="table-actions">
                          <button class="btn btn-primary btn-xs" :disabled="installingDobotPlus || installingName === item.name || !settingsWritable" @click="installDobotPlusPlugin(item.name)">
                            {{ installingName === item.name ? '安装中...' : '安装' }}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-muted" style="padding:12px 0;font-size:0.75rem">
                    未从控制器读到可安装插件 — 可上传插件包或手动输入完整包名安装。
                  </div>
                  <div style="display:flex;gap:6px;margin-top:10px">
                    <input v-model.trim="dobotPlusInstallName" class="input-sm settings-alias-input" placeholder="插件完整名（手动安装）" @keyup.enter="installDobotPlusPlugin()" />
                    <button class="btn btn-secondary btn-sm" :disabled="!dobotPlusInstallName || installingDobotPlus || !settingsWritable" @click="installDobotPlusPlugin()">
                      {{ installingDobotPlus ? '安装中...' : '安装' }}
                    </button>
                  </div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-header"><h4>上传插件包安装</h4></div>
                  <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                    <input type="file" accept=".zip" class="input-sm dobotplus-file-input" @change="onDobotPlusFileChange" />
                    <span v-if="dobotPlusUploadFile" class="text-muted" style="font-size:0.7rem">{{ dobotPlusUploadFile.name }}</span>
                    <button class="btn btn-primary btn-sm" :disabled="!dobotPlusUploadFile || uploadingDobotPlus || !isConnected || !settingsWritable" @click="uploadDobotPlusPlugin">
                      {{ uploadingDobotPlus ? '上传安装中...' : '上传并安装' }}
                    </button>
                  </div>
                  <div class="text-muted" style="margin-top:6px;font-size:0.68rem;line-height:1.6">
                    zip 文件名即插件名（如 DobotES01_v1-0-3-stable.zip）；上传到控制器 /developOnly/ecology/ 后自动安装。
                  </div>
                </div>
                <!-- 插件界面（本地资源 iframe） -->
                <div v-if="activeDobotPlusIframe" class="settings-section">
                  <div class="settings-section-header">
                    <h4>{{ activeDobotPlusIframeName }} <span class="text-muted">本地界面</span></h4>
                    <button class="btn btn-secondary btn-sm" @click="closeDobotPlusPanel"><span class="bic" v-html="svgIcons.x"></span>关闭</button>
                  </div>
                  <iframe
                    ref="dobotPlusIframeRef"
                    :src="`/dobot-plus/${encodeURIComponent(activeDobotPlusIframe)}/Main/index.html`"
                    class="dobotplus-iframe"
                    sandbox="allow-scripts allow-same-origin"
                    @load="onDobotPlusIframeLoad"
                  />
                </div>
                <!-- 插件控制台（原生，无本地界面时的回退） -->
                <div v-else-if="activeDobotPlus" class="settings-section">
                  <div class="settings-section-header">
                    <h4>{{ activeDobotPlus }} <span class="text-muted">端口 {{ dobotPlusPorts[activeDobotPlus] || '—' }}</span></h4>
                    <button class="btn btn-secondary btn-sm" @click="closeDobotPlusPanel"><span class="bic" v-html="svgIcons.x"></span>关闭</button>
                  </div>
                  <div class="text-muted" style="margin-bottom:8px;font-size:0.7rem;line-height:1.6">
                    控制器只提供 HTTP API（POST /dobotPlus/&lt;插件名&gt;/&lt;方法&gt;），下方直接调用插件方法；ES01 吸盘可用上方按钮快捷操作。
                  </div>
                  <div style="display:flex;gap:6px">
                    <input v-model.trim="dobotPlusCallFn" class="input-sm settings-alias-input" placeholder="方法名，如 DeControl" @keyup.enter="callDobotPlusMethod" />
                    <button class="btn btn-primary btn-sm" :disabled="!isConnected || dobotPlusCalling || !dobotPlusCallFn" @click="callDobotPlusMethod">
                      {{ dobotPlusCalling ? '调用中...' : '调用' }}
                    </button>
                  </div>
                  <textarea
                    v-model="dobotPlusCallArgs"
                    class="dobotplus-args-input"
                    rows="2"
                    placeholder="参数（JSON 数组），如 [1] 或 [0]；留空表示 []"
                  />
                  <pre v-if="dobotPlusCallResult !== null" class="dobotplus-result">{{ dobotPlusCallResult }}</pre>
                  <div v-if="dobotPlusCallError" class="text-danger" style="font-size:0.75rem;margin-top:6px">{{ dobotPlusCallError }}</div>
                </div>
              </div>

              <!-- docat 设置 -->
              <div v-else-if="settingsTab === 'docat'">
                <div class="settings-section">
                  <div class="settings-section-header"><h4>标定导出目录</h4></div>
                  <div style="display:flex;gap:8px">
                    <input v-model.trim="calibExportDir" class="input-sm settings-alias-input" placeholder="服务端导出目录，如 ./data/exports" @keyup.enter="saveCalibExportDir" :disabled="!isAdminUser" />
                    <button class="btn btn-primary btn-sm" :disabled="!calibExportDir || savingCalibExportDir || !isAdminUser" @click="saveCalibExportDir">
                      {{ savingCalibExportDir ? '保存中...' : '保存' }}
                    </button>
                    <button class="btn btn-secondary btn-sm" :disabled="!calibExportDir || openingCalibExportDir || !isAdminUser" @click="openCalibExportDir" title="用服务端的文件管理器打开该目录">
                      {{ openingCalibExportDir ? '打开中...' : '打开目录' }}
                    </button>
                  </div>
                  <div class="text-muted" style="margin-top:8px;font-size:0.68rem;line-height:1.6">
                    标定辅助「导出」按钮：左键将标定数据写入该目录下的 txt/xml 文件（服务端）；右键由浏览器直接下载文件。
                  </div>
                </div>
                <div class="settings-section">
                  <div class="settings-section-header"><h4>时间提醒</h4></div>
                  <label class="toggle-switch" style="justify-content:space-between">
                    <span class="toggle-label" style="min-width:0">检查设备时间</span>
                    <input type="checkbox" v-model="checkDeviceTime" @change="persistCheckDeviceTime" />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                  </label>
                  <div class="text-muted" style="margin-top:8px;font-size:0.68rem;line-height:1.6">
                    进入设备页面时自动检查设备时间，与当前时间偏差过大时提示同步。
                  </div>
                </div>
              </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../services/api'
import { clearToken } from '../services/api'
import { wsClient } from '../services/ws'
import {
  REF_JOINT,
  REF_POSE,
  forwardKinematics,
  inverseKinematics,
  jointsToObject,
  jointsFromObject,
  poseToObject,
  applyJointDelta,
  applyCartesianDelta,
} from '../services/offlineKin'
import { deviceStore } from '../stores/deviceStore'
import { clearWorkspace } from '../stores/workspaceState'
import { userStore } from '../stores/userStore'
import Toast from '../components/Toast.vue'
import type { DeviceConfig } from 'docat-shared/types'
import {
  maxLoadGramsForDevice,
  validateLoadWeight,
  validateOffset,
  validateAlias,
  validateIpv4,
  validateSsid,
  validateWifiPassword,
  validateDate,
  validateTime,
  validateTimeZone,
  validateUserPassword,
} from '../services/settingsValidation'
import {
  fitCalibration,
  applyCalibration,
  parseCalibTxt,
  parseCalibTxtFull,
  parseNumericTokens,
  buildCalibXml,
  type CalibPoint,
  type CalibModel,
  type WeightFn,
  type CalibResult,
} from '../services/calibration'

const route = useRoute()
const router = useRouter()
const deviceId = route.params.id as string
const toastRef = ref<InstanceType<typeof Toast>>()
const modelIframeRef = ref<HTMLIFrameElement | null>(null)

// ─── Mock / Dock 模式（URL ?mock=1 激活，无需设备即可调试 jog/移动/预设）───
// 笛卡尔位姿用 offline_kin 标定模型做 FK/IK，与 scripts/offline_kin.py 一致。
const isMock = route.query.mock === '1'
const MOCK_PRESET_KEY = `docat:mock:postures:${deviceId}`

if (isMock) {
  console.log('[Mock] Dock mode active — move/preset/jog 用离线运动学模拟')
  deviceStore.setConnected(deviceId, true, 'exclusive')
  deviceStore.setEnabled(deviceId, true)
  deviceStore.setDevices([{ id: deviceId, ip: '0.0.0.0', name: 'MOCK DEVICE (dock)', type: 'MG6', autoConnect: false, createdAt: '' }])
}

const device = ref<DeviceConfig | null>(deviceStore.getDevice(deviceId))

// Mock 初始状态：标定参考点（朝下姿态族），保证 FK/IK 开箱可用
const mockState = reactive({
  pose: poseToObject([...REF_POSE]),
  joints: jointsToObject([...REF_JOINT]),
})

const state = ref<Record<string, unknown>>(
  isMock
    ? { ...mockState, io: {}, alarm: [], status: { connected: true, mode: 'auto' }, timestamp: Date.now() }
    : (deviceStore.statuses[deviceId]?.state ?? { pose: { x: 0, y: 0, z: 0, r: 0 }, joints: {} })
)

/** Mock 运动动画句柄（关节/位姿 move 共用） */
let mockMoveRaf: number | null = null
let mockMoveAbort = false

function cancelMockMove() {
  mockMoveAbort = true
  if (mockMoveRaf != null) {
    cancelAnimationFrame(mockMoveRaf)
    mockMoveRaf = null
  }
}

/** 把 mock 关节/位姿写回 state，并驱动 3D */
function commitMockState(joints: Record<string, number>, pose: Record<string, number>) {
  const next = {
    ...state.value,
    joints: { ...joints },
    pose: { ...pose },
    timestamp: Date.now(),
  }
  state.value = next
  // 保持 mockState 同步（部分旧逻辑可能读它）
  Object.assign(mockState.joints, joints)
  Object.assign(mockState.pose, pose)
}

/**
 * Mock 平滑插补到目标关节（约 durationMs）。
 * 到位后用 FK 刷新 pose，保证笛卡尔显示一致。
 * 时长按速度滑块换算：duration = baseDurationMs * (100 / speedRatio)，100% 时为 baseDurationMs。
 */
function mockAnimateToJoints(target: number[], baseDurationMs = 200): Promise<boolean> {
  cancelMockMove()
  mockMoveAbort = false
  const ratio = Math.min(100, Math.max(1, speedRatio.value || 100))
  const durationMs = Math.round(baseDurationMs * (100 / ratio))
  const start = jointsFromObject(state.value.joints as Record<string, number>)
  const t0 = performance.now()
  return new Promise((resolve) => {
    const step = (now: number) => {
      if (mockMoveAbort) {
        mockMoveRaf = null
        resolve(false)
        return
      }
      const u = Math.min(1, (now - t0) / durationMs)
      // ease-in-out
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
      const cur = start.map((s, i) => s + (target[i] - s) * e)
      const fk = forwardKinematics(cur)
      commitMockState(jointsToObject(cur), poseToObject(fk))
      if (u < 1) {
        mockMoveRaf = requestAnimationFrame(step)
      } else {
        mockMoveRaf = null
        resolve(true)
      }
    }
    mockMoveRaf = requestAnimationFrame(step)
  })
}
const connecting = ref(false)
const enabled = ref(deviceStore.isEnabled(deviceId))
const enabling = ref(false)
const isAutoMode = ref(false)
const autoModeEnabled = ref(false)
const modeSwitching = ref(false)
const isOnlineMode = ref(true)
const moving = ref(false)
const moveTargetInit = ref(false)
const moveTarget = reactive<Record<string, number>>({ j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 })
const jointInputRefs = ref<HTMLInputElement[]>([])
const poseInputRefs = ref<HTMLInputElement[]>([])
const jogPanelRef = ref<HTMLElement | null>(null)
const modelReady = ref(false)
let last3DPose = ''

// ─── Alarms ──────────────────────────────────────

interface AlarmItem {
  id: number
  level: string | number
  message: string
  solution: string
  date: string
  time: string
  timestamp: number
}
const currentAlarms = ref<AlarmItem[]>([])
const currentWarnings = ref<AlarmItem[]>([])
const isCollision = ref(false)
const protectiveStop = ref(false)
const emergencyStop = ref(false)

const hasAlarms = computed(() => currentAlarms.value.length > 0)
const hasWarnings = computed(() => currentWarnings.value.length > 0)

function normalizeAlarmItem(raw: Partial<AlarmItem> & { id: number }, fallbackPrefix: string): AlarmItem {
  return {
    id: raw.id,
    level: raw.level ?? '',
    message: raw.message || `${fallbackPrefix} ${raw.id}`,
    solution: raw.solution || '',
    date: raw.date || '',
    time: raw.time || '',
    timestamp: raw.timestamp || Date.now(),
  }
}

function normalizeWarningItem(raw: number | Partial<AlarmItem> & { id: number }): AlarmItem {
  if (typeof raw === 'number') {
    return normalizeAlarmItem({ id: raw }, 'Warning')
  }
  return normalizeAlarmItem(raw, 'Warning')
}

/**
 * 兼容多种 alarm 载荷：
 * - AlarmInfo[]（driver 解析后）
 * - number[][]（控制器原始 alarms）
 * - number[] / 对象数组
 */
function coerceAlarmList(raw: unknown): Array<Partial<AlarmItem> & { id: number }> {
  if (!raw) return []
  if (!Array.isArray(raw)) return []

  // number[][] — 控制器原始格式
  if (raw.length > 0 && Array.isArray(raw[0])) {
    const codes = (raw as unknown[][]).flat()
      .filter((c): c is number => typeof c === 'number' && c !== 0)
    return codes.map(id => ({ id }))
  }

  return (raw as unknown[])
    .map((item): (Partial<AlarmItem> & { id: number }) | null => {
      if (typeof item === 'number' && item !== 0) return { id: item }
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'number') {
        return item as Partial<AlarmItem> & { id: number }
      }
      return null
    })
    .filter((item): item is Partial<AlarmItem> & { id: number } => item !== null)
}

function mergeAlarmDetails(next: AlarmItem[], existing: AlarmItem[]): AlarmItem[] {
  return next.map(item => {
    const previous = existing.find(e => e.id === item.id)
    if (!previous) return item
    return {
      ...item,
      level: item.level !== '' ? item.level : previous.level,
      message: item.message !== `Alarm ${item.id}` && item.message !== `Warning ${item.id}` ? item.message : previous.message,
      solution: item.solution || previous.solution,
      date: item.date || previous.date,
      time: item.time || previous.time,
      timestamp: item.timestamp || previous.timestamp,
    }
  })
}

function toAlarmItemFromApi(entry: api.DeviceAlarm, fallbackPrefix: string): AlarmItem {
  return {
    id: entry.id,
    level: entry.level ?? '',
    message: entry.description || `${fallbackPrefix} ${entry.id}`,
    solution: entry.solution || '',
    date: entry.date || '',
    time: entry.time || '',
    timestamp: Date.now(),
  }
}

/** 将 exchange 中的轻量列表立即同步到主界面，详情异步补全 */
function applyRealtimeAlarms(rawList: unknown) {
  const next = coerceAlarmList(rawList).map(a => normalizeAlarmItem(a, 'Alarm'))
  currentAlarms.value = mergeAlarmDetails(next, currentAlarms.value)
}

function applyRealtimeWarnings(rawList: unknown) {
  const list = Array.isArray(rawList) ? rawList : []
  const next = list.map(w => normalizeWarningItem(w as number | Partial<AlarmItem> & { id: number }))
  currentWarnings.value = mergeAlarmDetails(next, currentWarnings.value)
}

// ─── Device Log / Alarm Descriptions ─────────────

interface DeviceLogEntry {
  id: number
  type: string
  level: string | number
  description: string
  solution: string
  date: string
  time: string
}
const deviceLogs = ref<DeviceLogEntry[]>([])
const showLogs = ref(false)
const showSettings = ref(false)
let alarmDetailSeq = 0
let warningDetailSeq = 0
let deviceLogSeq = 0
const showDobotPlusBar = ref(false)
const settingsTab = ref('system')
/** SVG 图标库（内联字符串，v-html 渲染；stroke 风格与全站一致） */
const svgIcons: Record<string, string> = {
  check: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  pen: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5 13.5 4.5 6.5 11.5 3.5 12.5 4.5 9.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10.5 3.5 12.5 5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2.5 4h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6 4V2.5h4V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4l.8 9a1.5 1.5 0 0 0 1.5 1.5h3.4A1.5 1.5 0 0 0 11.2 13L12 4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  stop: '<svg width="12" height="12" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/></svg>',
  record: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>',
  save: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 2.5V6h6V2.5" stroke="currentColor" stroke-width="1.4"/><rect x="5" y="9" width="6" height="4.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  bolt: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8.5 1.5 3 9h3.5l-1 5.5L13 7H9l-.5-5.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  home: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2.5 7.5 8 2.5l5.5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 7v6.5h8V7" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  refresh: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M13.5 2.5V5.7h-3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 14.5S3.5 10.3 3.5 7a4.5 4.5 0 0 1 9 0c0 3.3-4.5 7.5-4.5 7.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="7" r="1.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  clipboard: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="4" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4"/><path d="M5 7h6M5 9.5h6M5 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  info: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2v3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="5" r="0.8" fill="currentColor"/></svg>',
  warn: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2.5 14.5 13.5h-13L8 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.5v3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.4" r="0.7" fill="currentColor"/></svg>',
  pause: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3.5" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9.5" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>',
  puzzle: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 2.5h7A1.5 1.5 0 0 1 11.5 4v1.5a1.5 1.5 0 0 1 0 3V12A1.5 1.5 0 0 1 10 13.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  gear: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.8v2M8 12.2v2M14.2 8h-2M3.8 8h-2M12.3 3.7l-1.4 1.4M5.1 10.9 3.7 12.3M12.3 12.3l-1.4-1.4M5.1 5.1 3.7 3.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  user: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.2" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 14a5.5 5.5 0 0 1 11 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  axes: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  weight: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6 5.5V4.5A2 2 0 0 1 10 4.5v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 6.5h10l-1 6H4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 8.5v1M10 8.5v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  move: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5 4.5 8 1.5l3 3M5 11.5l3 3 3-3M4.5 5 1.5 8l3 3M11.5 5l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  globe: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M2 8h12M8 2c2.4 2.4 2.4 9.6 0 12M8 2c-2.4 2.4-2.4 9.6 0 12" stroke="currentColor" stroke-width="1.4"/></svg>',
  button: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="5.5" width="13" height="5" rx="2.5" stroke="currentColor" stroke-width="1.4"/><circle cx="11" cy="8" r="1.3" fill="currentColor"/></svg>',
  battery: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="4.5" width="11.5" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M14 6.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="3" y="6.5" width="4" height="3" rx="0.5" fill="currentColor"/></svg>',
  antenna: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 2.5a10 10 0 0 1 8 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5.8 5.2a6 6 0 0 1 4.4 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 7.5v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="13" r="1.3" stroke="currentColor" stroke-width="1.4"/></svg>',
  grip: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/><circle cx="10.5" cy="5.5" r="1.2" fill="currentColor"/><circle cx="5.5" cy="10.5" r="1.2" fill="currentColor"/><circle cx="10.5" cy="10.5" r="1.2" fill="currentColor"/></svg>',
  cat: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3.5 3 5 6.2A4.5 4.5 0 1 0 11 6.2L12.5 3 11 5.5H5L3.5 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="6.4" cy="9" r="0.8" fill="currentColor"/><circle cx="9.6" cy="9" r="0.8" fill="currentColor"/><path d="M6.4 11c.5.4 1.3.5 2 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
}
const ALL_SETTINGS_TABS = [
  { key: 'system', icon: 'gear', label: '系统' },
  { key: 'users', icon: 'user', label: '用户' },
  { key: 'coordinates', icon: 'axes', label: '坐标系' },
  { key: 'load', icon: 'weight', label: '负载参数' },
  { key: 'postures', icon: 'pin', label: '姿态' },
  { key: 'motion', icon: 'move', label: '运动' },
  { key: 'comm', icon: 'globe', label: '通讯' },
  { key: 'key', icon: 'button', label: '按键' },
  { key: 'power', icon: 'battery', label: '电源' },
  { key: 'remote', icon: 'antenna', label: '远程控制' },
  { key: 'drag', icon: 'grip', label: '拖拽' },
  { key: 'dobotplus', icon: 'puzzle', label: 'Dobot+' },
  { key: 'docat', icon: 'cat', label: 'docat' },
]
/** Magician 只保留 姿态 与 docat 两个 tab */
const settingsTabs = computed(() =>
  isMagician.value
    ? ALL_SETTINGS_TABS.filter(t => t.key === 'postures' || t.key === 'docat')
    : ALL_SETTINGS_TABS,
)
// 当前 tab 不在可用列表时（如 Magician 无 system），回退到第一个可用 tab
// 注意：不能 watch(settingsTabs)——watch 会在 setup 阶段求值源（TDZ：isMagician 在文件后部声明）
// 由 toggleSettings 打开面板时调用；isMagician 变化时由下方 watch(isMagician) 联动
function syncSettingsTab() {
  const tabs = settingsTabs.value
  if (!tabs.some(t => t.key === settingsTab.value)) {
    settingsTab.value = tabs[0]?.key ?? ''
  }
}

// 设置写操作保护：viewer 只读（对齐服务端 requireOperator）；自动模式下禁止修改（对齐 OpenDobot46 isShowMask）
const settingsWritable = computed(() => {
  if (isMock) return true
  return userStore.currentUser?.role !== 'viewer' && !isAutoMode.value && isConnected.value
})

/** docat 管理员（标定导出目录等系统级设置需要 admin） */
const isAdminUser = computed(() => userStore.currentUser?.role === 'admin')

/** 危险操作确认（复用 Toast actions，常驻直至用户选择） */
function confirmAction(message: string, onConfirm: () => void | Promise<void>, confirmLabel = '确认删除') {
  toastRef.value?.error(message, {
    duration: 0,
    actions: [
      { label: '取消', handler: () => {} },
      { label: confirmLabel, variant: 'danger', handler: () => { void onConfirm() } },
    ],
  })
}

/** 切换 tab 时清理各表单的编辑状态，避免残留 */
function resetSettingsEditState() {
  editingCoordIdx.value = -1
  editingCoordType.value = ''
  addingCoord.value = false
  editingPostureIdx.value = null
  renamingPostureKey.value = ''
  editingUserIdx.value = null
  addingUser.value = false
  addingPreset.value = false
  editingPresetIdx.value = null
}
const loadingLogs = ref(false)
const logListRef = ref<HTMLElement>()
const logPanelTab = ref<'alarms' | 'history'>('alarms')

const historyTypeOptions = ['error', 'warning', 'info', 'user']
const historyLogStart = ref(todayDateString())
const historyLogEnd = ref(todayDateString())
const historyLogKeyword = ref('')
const historyLogTypes = ref<string[]>([...historyTypeOptions])
const historyLogEntries = ref<api.ControlLogLine[]>([])
const historyLogFiles = ref<api.ControlLogFile[]>([])
const historyLogTotal = ref(0)
const historyLogLimited = ref(false)
const loadingHistoryLogs = ref(false)

const visibleLogLoading = computed(() => logPanelTab.value === 'alarms' ? loadingLogs.value : loadingHistoryLogs.value)
const logRefreshDisabled = computed(() => {
  if (logPanelTab.value === 'alarms') return !isConnected.value || loadingLogs.value
  return loadingHistoryLogs.value || historyLogTypes.value.length === 0
})
const logCountText = computed(() => {
  if (logPanelTab.value === 'alarms') return `${deviceLogs.value.length} 条`
  const suffix = historyLogLimited.value ? ` / ${historyLogTotal.value}` : ''
  return `${historyLogEntries.value.length}${suffix} 条`
})
const robotModelType = computed(() => normalizeRobotModelType(device.value?.type || device.value?.name || 'MG6'))

/** 是否 Magician（4 轴串口机）：控制 UI 显示与轴数 */
const isMagician = computed(() => robotModelType.value === 'Magician')
/** Magician 无历史日志功能：切到 Magician 时强制回到告警页（组件跨设备复用时会残留 history） */
watch(isMagician, (m) => {
  if (m) logPanelTab.value = 'alarms'
})
/** 关节轴数：Magician=4，其余 6 */
const jointCount = computed(() => (isMagician.value ? 4 : 6))
/** 位姿显示轴：Magician 用 XYZR（R 占 RX 位置），其余 XYZ+RXRYRZ */
const poseAxes = computed(() =>
  isMagician.value
    ? (['x', 'y', 'z', 'r'] as const)
    : (['x', 'y', 'z', 'rx', 'ry', 'rz'] as const),
)
/** 移动/预设板块固定渲染 6 个位姿框（与 6 轴机型布局一致），超出机型轴数者隐藏占位 */
const fullPoseAxes = computed(() =>
  isMagician.value
    ? (['x', 'y', 'z', 'r', 'ry', 'rz'] as const)
    : (['x', 'y', 'z', 'rx', 'ry', 'rz'] as const),
)
/** Magician 上隐藏占位的多余位姿轴 */
const hiddenPoseAxes = computed<string[]>(() => (isMagician.value ? ['ry', 'rz'] : []))

function normalizeRobotModelType(raw: string): string {
  const value = String(raw || '').toUpperCase().replace(/\s+/g, '')
  // Magician（4 轴）优先于 E6/MG6 判断："Magician E6" 是 6 轴 MG6，"Magician" 是 4 轴
  if (value.includes('MAGICIAN') && !value.includes('E6')) return 'Magician'
  if (value.includes('MG6') || value.includes('E6')) return 'MG6'
  if (value.includes('CR30')) return 'CR30'
  if (value.includes('CR20AF')) return 'CR20AF'
  if (value.includes('CR20V')) return 'CR20V'
  if (value.includes('CR20')) return 'CR20'
  if (value.includes('CR16V')) return 'CR16V'
  if (value.includes('CR16')) return 'CR16'
  if (value.includes('CR12V')) return 'CR12V'
  if (value.includes('CR12')) return 'CR12'
  if (value.includes('CR10AF')) return 'CR10AF'
  if (value.includes('CR10V')) return 'CR10V'
  if (value.includes('CR10')) return 'CR10'
  if (value.includes('CR7V')) return 'CR7V'
  if (value.includes('CR7')) return 'CR7'
  if (value.includes('CR5AF')) return 'CR5AF'
  if (value.includes('CR5V')) return 'CR5V'
  if (value.includes('CR5')) return 'CR5'
  if (value.includes('CR3L')) return 'CR3L'
  if (value.includes('CR3V')) return 'CR3V'
  if (value.includes('CR3')) return 'CR3'
  if (value.includes('NC05')) return 'NC05'
  if (value.includes('NC02S')) return 'NC02s'
  if (value.includes('NC02L')) return 'NC02L'
  if (value.includes('NC02')) return 'NC02'
  return 'MG6'
}

function post3DMessage(method: string, data: unknown) {
  const target = modelIframeRef.value?.contentWindow
  if (!target) return
  target.postMessage({ method, data }, '*')
}

function build3DPose(): Record<string, number> {
  const pose = state.value.pose as Record<string, number> | undefined
  const joints = state.value.joints as Record<string, number> | undefined
  return {
    J1: Number(joints?.j1 ?? 0),
    J2: Number(joints?.j2 ?? 0),
    J3: Number(joints?.j3 ?? 0),
    J4: Number(joints?.j4 ?? 0),
    J5: Number(joints?.j5 ?? 0),
    J6: Number(joints?.j6 ?? 0),
    X: Number(pose?.x ?? 0),
    Y: Number(pose?.y ?? 0),
    Z: Number(pose?.z ?? 0),
    Rx: Number(pose?.rx ?? pose?.r ?? 0),
    Ry: Number(pose?.ry ?? 0),
    Rz: Number(pose?.rz ?? 0),
  }
}

function sync3DModelType() {
  post3DMessage('getDeviceType', { type: robotModelType.value })
}

function sync3DPose(force = false) {
  const pose = build3DPose()
  const serialized = JSON.stringify(pose)
  if (!force && serialized === last3DPose) return
  last3DPose = serialized
  post3DMessage('getPose', pose)
}

function reset3DView() {
  post3DMessage('setCameraPosition', robotModelType.value.startsWith('CR')
    ? { y: 600, z: 750 }
    : { x: 100, y: 500, z: 1800 })
  post3DMessage('setZoom', robotModelType.value.startsWith('CR') ? 0.5 : 1.5)
  post3DMessage('changeBgc', 'black')
  sync3DModelType()
  sync3DPose(true)
}

function on3DModelLoad() {
  modelReady.value = false
  last3DPose = ''
  reset3DView()
  inject3DKeyForwarding()
}

/** 注入到 3D iframe 的按键转发脚本：iframe 内键盘事件不冒泡到父页面，需主动转发 */
const JOG_KEY_FORWARD_SCRIPT = `
(function () {
  var FORWARD_KEYS = {
    ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
    Shift: 'shift', ' ': 'space',
    '-': 'minus', '_': 'minus', '=': 'equal', '+': 'equal',
    b: 'b', B: 'b', n: 'n', N: 'n', m: 'm', M: 'm'
  }
  function isEditable(el) {
    if (!el) return false
    var tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
  }
  function forward(type, e) {
    var norm = FORWARD_KEYS[e.key]
    if (!norm) return
    if (isEditable(e.target)) return
    e.preventDefault()
    try {
      window.parent.postMessage({
        iframeName: '3dmodelplugin',
        method: 'jogKey',
        type: type,
        key: norm,
        repeat: !!e.repeat,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey
      }, '*')
    } catch (err) {}
  }
  window.addEventListener('keydown', function (e) { forward('keydown', e) }, true)
  window.addEventListener('keyup', function (e) { forward('keyup', e) }, true)
})()
`

/** 3D iframe 加载后注入方向键转发（同源，可直接操作 contentDocument） */
function inject3DKeyForwarding() {
  const doc = modelIframeRef.value?.contentDocument
  if (!doc || doc.getElementById('docat-jog-forward')) return
  const script = doc.createElement('script')
  script.id = 'docat-jog-forward'
  script.textContent = JOG_KEY_FORWARD_SCRIPT
  doc.body?.appendChild(script)
}

function handle3DModelMessage(event: MessageEvent) {
  const data = event.data
  if (!data || typeof data !== 'object') return
  const frame = modelIframeRef.value
  const is3D = (data as Record<string, unknown>).iframeName === '3dmodelplugin'
  // 只接受来自当前 3D iframe 的消息，防止外部窗口伪造 jog 消息
  if (!is3D || event.source !== frame?.contentWindow) return
  const method = (data as Record<string, unknown>).method
  if (method === 'loadModelOver') {
    modelReady.value = true
    sync3DPose(true)
    return
  }
  if (method === 'jogKey') {
    handleJogKeyFrom3D(data as unknown as JogKeyFrom3DMessage)
  }
}

function todayDateString(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function closeTopOverlay() {
  if (showSettings.value) {
    showSettings.value = false
    return true
  }
  if (showLogs.value) {
    showLogs.value = false
    return true
  }
  if (showTrajectory.value) {
    showTrajectory.value = false
    return true
  }
  if (showDobotPlusBar.value) {
    showDobotPlusBar.value = false
    return true
  }
  return false
}

function closeSiblingSidePanels(except: 'logs' | 'trajectory' | 'settings') {
  if (except !== 'logs' && showLogs.value) showLogs.value = false
  if (except !== 'trajectory' && showTrajectory.value) showTrajectory.value = false
  if (except !== 'settings' && showSettings.value) showSettings.value = false
}

function toggleLogs() {
  showLogs.value = !showLogs.value
  if (!showLogs.value) return
  closeSiblingSidePanels('logs')
  if (logPanelTab.value === 'alarms') fetchDeviceLogs()
  if (logPanelTab.value === 'history' && historyLogEntries.value.length === 0) fetchControlLogs()
}

function toggleTrajectory() {
  showTrajectory.value = !showTrajectory.value
  if (!showTrajectory.value) return
  closeSiblingSidePanels('trajectory')
}

function toggleSettings() {
  showSettings.value = !showSettings.value
  if (!showSettings.value) return
  closeSiblingSidePanels('settings')
  // 打开时同步默认 tab（Magician 无 system 等 tab）
  syncSettingsTab()
}

function switchLogTab(tab: 'alarms' | 'history') {
  logPanelTab.value = tab
  if (tab === 'alarms' && deviceLogs.value.length === 0) fetchDeviceLogs()
  if (tab === 'history' && historyLogEntries.value.length === 0) fetchControlLogs()
}

function refreshVisibleLogs() {
  if (logPanelTab.value === 'alarms') {
    fetchDeviceLogs()
  } else {
    fetchControlLogs()
  }
}

/** 主动拉告警详情（对齐官方 isAlarmUpdate → getAlarms） */
async function fetchAlarmDetails() {
  if (!isConnected.value || isMock) return
  const seq = ++alarmDetailSeq
  try {
    const res = await api.getDeviceAlarms(deviceId)
    if (seq !== alarmDetailSeq) return
    if (res.success && res.data) {
      const next = res.data.map(a => toAlarmItemFromApi(a, 'Alarm'))
      // 即使为空也覆盖：告警清除后主界面必须同步消失
      currentAlarms.value = next
      rebuildDeviceLogsFromPanels()
    }
  } catch { /* ignore */ }
}

/** 主动拉警告详情（对齐官方 isWarningUpdate → getWarnings） */
async function fetchWarningDetails() {
  if (!isConnected.value || isMock) return
  const seq = ++warningDetailSeq
  try {
    const res = await api.getDeviceWarnings(deviceId)
    if (seq !== warningDetailSeq) return
    if (res.success && res.data) {
      const next = res.data.map(w => toAlarmItemFromApi(w, 'Warning'))
      // 即使为空也覆盖：警告消除后主界面必须同步消失
      currentWarnings.value = next
      rebuildDeviceLogsFromPanels()
    }
  } catch { /* ignore */ }
}

/** 用主界面当前告警/警告重建日志面板告警 tab，避免“日志有、主界面无” */
function rebuildDeviceLogsFromPanels() {
  const entries: DeviceLogEntry[] = [
    ...currentAlarms.value.map(a => ({
      id: a.id,
      type: 'alarm',
      level: a.level,
      description: a.message,
      solution: a.solution,
      date: a.date,
      time: a.time,
    })),
    ...currentWarnings.value.map(w => ({
      id: w.id,
      type: 'warning',
      level: w.level,
      description: w.message,
      solution: w.solution,
      date: w.date,
      time: w.time,
    })),
  ]
  entries.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
  // 仅在完整 fetch 未进行时，用面板数据兜底同步日志列表
  if (!loadingLogs.value) {
    deviceLogs.value = entries
  }
}

async function fetchDeviceLogs() {
  if (!isConnected.value) return
  const seq = ++deviceLogSeq
  loadingLogs.value = true
  try {
    const [alarmRes, warnRes] = await Promise.all([
      api.getDeviceAlarms(deviceId),
      api.getDeviceWarnings(deviceId),
    ])
    if (seq !== deviceLogSeq) return

    const entries: DeviceLogEntry[] = []
    let nextAlarms: AlarmItem[] | null = null
    let nextWarnings: AlarmItem[] | null = null

    if (alarmRes.success && alarmRes.data) {
      nextAlarms = alarmRes.data.map(a => toAlarmItemFromApi(a, 'Alarm'))
      for (const a of alarmRes.data) {
        entries.push({
          id: a.id,
          type: 'alarm',
          level: a.level ?? '',
          description: a.description,
          solution: a.solution || '',
          date: a.date,
          time: a.time,
        })
      }
    }
    if (warnRes.success && warnRes.data) {
      nextWarnings = warnRes.data.map(w => toAlarmItemFromApi(w, 'Warning'))
      for (const w of warnRes.data) {
        entries.push({
          id: w.id,
          type: 'warning',
          level: w.level ?? '',
          description: w.description,
          solution: w.solution || '',
          date: w.date,
          time: w.time,
        })
      }
    }

    entries.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    deviceLogs.value = entries

    // 始终用完整详情覆盖主界面，包括空列表（清除后同步）
    if (nextAlarms) currentAlarms.value = nextAlarms
    if (nextWarnings) currentWarnings.value = nextWarnings
  } catch { /* ignore */ }
  finally {
    if (seq === deviceLogSeq) loadingLogs.value = false
  }
}

async function fetchControlLogs() {
  if (historyLogTypes.value.length === 0) {
    toastRef.value?.error('请至少选择一种日志类型')
    return
  }
  loadingHistoryLogs.value = true
  try {
    const res = await api.queryControlLogs(deviceId, {
      start: historyLogStart.value,
      end: historyLogEnd.value,
      types: historyLogTypes.value,
      keyword: historyLogKeyword.value,
      limit: 1000,
    })
    if (res.success && res.data) {
      historyLogEntries.value = res.data.entries
      historyLogFiles.value = res.data.files
      historyLogTotal.value = res.data.total
      historyLogLimited.value = res.data.limited
      if (res.data.limited) {
        toastRef.value?.info(`共匹配 ${res.data.total} 条日志，当前显示前 ${res.data.entries.length} 条`)
      } else if (res.data.entries.length === 0) {
        const message = res.data.files.length > 0
          ? `在 ${res.data.files.length} 个日志文件中未找到匹配行`
          : '所选日期范围内无日志文件'
        toastRef.value?.info(message)
      }
    } else {
      toastRef.value?.error(`历史日志查询失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`历史日志出错：${(err as Error).message}`)
  } finally {
    loadingHistoryLogs.value = false
  }
}

function historyLogIcon(level: string): string {
  if (level === 'error') return svgIcons.x
  if (level === 'warning') return '!'
  if (level === 'user') return '*'
  return svgIcons.info
}

watch(state, () => sync3DPose(), { deep: true })
watch(robotModelType, () => {
  sync3DModelType()
  reset3DView()
})

const isConnected = computed(() => deviceStore.isConnected(deviceId))
const isVirtualMode = computed(() => deviceStore.isVirtual(deviceId))
/** 回零：Magician 支持（HOMECmd）；其余机型预留，默认隐藏 */
const supportsHome = ref(false)
watch(isMagician, (v) => {
  supportsHome.value = v
  // 机型变化时同步设置面板可用 tab（isMagician 在此之后声明，可安全求值）
  syncSettingsTab()
}, { immediate: true })
const tcpDown = ref(false)

// ─── Speed Ratio ─────────────────────────────────
const speedRatio = ref(100)
let speedDebounceTimer: ReturnType<typeof setTimeout> | null = null

// ─── Jog State ───────────────────────────────────

type JogCoordinateMode = 'joint' | 'cartesian' | 'tool'
/** 点动轴列表：Magician 四轴（关节 J1-4，笛卡尔 XYZR——R 占 RX 位置） */
const JOINT_AXES = computed(() => (isMagician.value
  ? (['j1', 'j2', 'j3', 'j4'] as const)
  : (['j1', 'j2', 'j3', 'j4', 'j5', 'j6'] as const)))
const CARTESIAN_AXES = computed(() => (isMagician.value
  ? (['x', 'y', 'z', 'r'] as const)
  : (['x', 'y', 'z', 'rx', 'ry', 'rz'] as const)))

const jogCoordinate = ref<JogCoordinateMode>('joint')
const jogCoordSwitching = ref(false)
const jogAxis = ref('j1')
const jogDir = ref('+')
const jogMode = ref<'continuous' | 'step'>('continuous')
const jogInch = ref(1)
const inchPresets = [0.01, 0.1, 0.5, 1]
const jogActive = ref(false)
const jogInterval = ref<ReturnType<typeof setInterval> | null>(null)
const stepTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const jogStartPose = ref<Record<string, number>>({})
const ampTravel = ref(0)
/** 最大增量（mm/°）；0 = 不限制、持续移动，值持久化到浏览器 */
const AMP_LIMIT_STORAGE_KEY = 'docat.ampLimit'
const ampLimit = ref(50)
try {
  const saved = Number(localStorage.getItem(AMP_LIMIT_STORAGE_KEY))
  if (Number.isFinite(saved) && saved >= 0) ampLimit.value = saved
} catch { /* ignore */ }
watch(ampLimit, (v: number | string) => {
  if (v === '' || v == null) return
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) {
    try { localStorage.setItem(AMP_LIMIT_STORAGE_KEY, String(n)) } catch { /* ignore */ }
  }
})
const appliedJogMode = ref<'jog' | 'step' | null>(null)
const appliedTeachInch = ref<number | null>(null)
const appliedJogCoordinate = ref<JogCoordinateMode | null>(null)
const moveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
let moveTargetJoints: number[] | null = null
/** 点动代数：松手/换轴时递增，丢弃过期的 in-flight jog 请求结果 */
let jogGeneration = 0
/** 串行化 REST 降级路径的 jog/stop（WS 路径不需要串行） */
let jogCmdChain: Promise<void> = Promise.resolve()
/**
 * 续发间隔。
 * 官方默认 200ms 偏稳；有服务端串行队列后可用 ~100ms 更跟手。
 * 再低（如 50ms）容易在 RTT 高时堆积，反而一卡一卡。
 */
const JOG_REPEAT_MS = 100
/** 上一次续发是否仍在途（仅用于跳过堆积，不阻塞首包） */
let jogTickInFlight = false

const activeJogAxes = computed(() =>
  jogCoordinate.value === 'joint' ? [...JOINT_AXES.value] : [...CARTESIAN_AXES.value]
)

const jogAxisUnit = computed(() => {
  if (jogAxis.value.startsWith('j') || jogAxis.value.startsWith('r')) return '°'
  return 'mm'
})

function formatJogAxisName(axis: string): string {
  return axis.toUpperCase()
}

function formatJogAxisValue(axis: string): string {
  if (axis.startsWith('j')) {
    return `${getJoint(Number(axis.slice(1)))}°`
  }
  const unit = axis.startsWith('r') ? '°' : 'mm'
  return `${getPoseVal(axis)}${unit}`
}

function beginAxisJog(axis: string, dir: string) {
  jogAxis.value = axis
  startJog(dir)
}

// ─── Keyboard Shortcuts ──────────────────────────

/** 规范化按键 id（方向键 / Space / Shift 等） */
function normalizeJogKey(e: KeyboardEvent): string {
  const k = e.key
  if (k === ';' ) return 'semicolon'
  if (k === ' ' || k === 'Spacebar' || e.code === 'Space') return 'space'
  if (k === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'shift'
  if (k === '-' || k === '_') return 'minus'
  if (k === '=' || k === '+') return 'equal'
  if (k.startsWith('Arrow')) return k.toLowerCase() // arrowup/down/left/right
  return k.toLowerCase()
}

/**
 * 飞行键基准映射：WASD + Shift/Space + 方向键 → 笛卡尔 X/Y/Z
 * W=Y+  A=X-  S=Y-  D=X+  Shift=Z-  Space=Z+
 * -/_=Z-  =/+=Z+（编辑框内：- 留给负号输入，用 _ 与 =/+ 调 Z）
 * ↑=Y+  ↓=Y-  ←=X-  →=X+
 * WASD + 方向键的 X/Y 方向由四向模式决定（A=正向 B=反转 C=右转90° D=左转90°）；
 * Shift/Space（Z）不参与。
 */
const FLIGHT_KEY_BASE: Record<string, { axis: string; dir: string }> = {
  w: { axis: 'y', dir: '+' },
  a: { axis: 'x', dir: '-' },
  s: { axis: 'y', dir: '-' },
  d: { axis: 'x', dir: '+' },
  shift: { axis: 'z', dir: '-' },
  space: { axis: 'z', dir: '+' },
  minus: { axis: 'z', dir: '-' },
  equal: { axis: 'z', dir: '+' },
  arrowup: { axis: 'y', dir: '+' },
  arrowdown: { axis: 'y', dir: '-' },
  arrowleft: { axis: 'x', dir: '-' },
  arrowright: { axis: 'x', dir: '+' },
}

/** WASD 方向四模式：A=正向（W→Y+） B=反转（W→Y-） C=右转90°（W→X+） D=左转90°（W→X-） */
type WasdDir = 'a' | 'b' | 'c' | 'd'

/** 四模式下 WASD + 方向键（X/Y 键）各自的映射；Shift/Space（Z）不在此表 */
const FLIGHT_XY_MODE_MAP: Record<WasdDir, Record<string, { axis: string; dir: string }>> = {
  a: {
    w: { axis: 'y', dir: '+' }, a: { axis: 'x', dir: '-' },
    s: { axis: 'y', dir: '-' }, d: { axis: 'x', dir: '+' },
    arrowup: { axis: 'y', dir: '+' }, arrowleft: { axis: 'x', dir: '-' },
    arrowdown: { axis: 'y', dir: '-' }, arrowright: { axis: 'x', dir: '+' },
  },
  b: {
    w: { axis: 'y', dir: '-' }, a: { axis: 'x', dir: '+' },
    s: { axis: 'y', dir: '+' }, d: { axis: 'x', dir: '-' },
    arrowup: { axis: 'y', dir: '-' }, arrowleft: { axis: 'x', dir: '+' },
    arrowdown: { axis: 'y', dir: '+' }, arrowright: { axis: 'x', dir: '-' },
  },
  c: {
    w: { axis: 'x', dir: '+' }, a: { axis: 'y', dir: '+' },
    s: { axis: 'x', dir: '-' }, d: { axis: 'y', dir: '-' },
    arrowup: { axis: 'x', dir: '+' }, arrowleft: { axis: 'y', dir: '+' },
    arrowdown: { axis: 'x', dir: '-' }, arrowright: { axis: 'y', dir: '-' },
  },
  d: {
    w: { axis: 'x', dir: '-' }, a: { axis: 'y', dir: '-' },
    s: { axis: 'x', dir: '+' }, d: { axis: 'y', dir: '+' },
    arrowup: { axis: 'x', dir: '-' }, arrowleft: { axis: 'y', dir: '-' },
    arrowdown: { axis: 'x', dir: '+' }, arrowright: { axis: 'y', dir: '+' },
  },
}

const WASD_DIR_STORAGE_KEY = 'docat.wasdDir'
const LEGACY_WASD_INVERT_STORAGE_KEY = 'docat.wasdInvert'
const wasdDir = ref<WasdDir>('a')
try {
  const saved = localStorage.getItem(WASD_DIR_STORAGE_KEY) as WasdDir | null
  if (saved === 'a' || saved === 'b' || saved === 'c' || saved === 'd') {
    wasdDir.value = saved
  } else if (localStorage.getItem(LEGACY_WASD_INVERT_STORAGE_KEY) === '1') {
    wasdDir.value = 'b'
  } else {
    // 机型默认朝向：Magician 朝下（下箭头按钮），E6/MG6 朝右（右箭头按钮）；用户可调节并记住
    wasdDir.value = isMagician.value ? 'd' : 'b'
  }
} catch { /* ignore */ }

/** 中心指针旋转角：指示当前模式下 W 键指向 */
const WASD_DIR_ROTATE: Record<WasdDir, number> = { a: 0, b: 180, c: 90, d: 270 }
const wasdDirArrow = computed(() =>
  ({ 0: '↑', 180: '↓', 90: '→', 270: '←' } as const)[WASD_DIR_ROTATE[wasdDir.value]]
)

/** 坐标编辑框内仍放行的点动键：WASD（X/Y）+ =（Z+）；普通 - 保留给负号输入，仅 _（Shift+-）触发 Z- */
const JOG_IN_EDIT_KEYS = new Set(['w', 'a', 's', 'd', 'equal'])

function setWasdDir(mode: WasdDir) {
  if (wasdDir.value === mode) return
  // 切换时若正在用飞行键点动，先停，避免方向突变
  if (jogActive.value) stopJog()
  keysDown.clear()
  wasdDir.value = mode
  try {
    localStorage.setItem(WASD_DIR_STORAGE_KEY, mode)
  } catch { /* ignore */ }
}

function resolveFlightMapping(key: string): { axis: string; dir: string } | undefined {
  return FLIGHT_XY_MODE_MAP[wasdDir.value][key] ?? FLIGHT_KEY_BASE[key]
}

const jointKeyMap = computed<Record<string, { axis: string; dir: string }>>(() => ({
  y: { axis: 'j1', dir: '+' }, h: { axis: 'j1', dir: '-' },
  u: { axis: 'j2', dir: '+' }, j: { axis: 'j2', dir: '-' },
  i: { axis: 'j3', dir: '+' }, k: { axis: 'j3', dir: '-' },
  o: { axis: 'j4', dir: '+' }, l: { axis: 'j4', dir: '-' },
  // J5/J6 仅 6 轴机型；Magician（4 轴）不映射
  ...(isMagician.value ? {} : {
    p: { axis: 'j5', dir: '+' }, semicolon: { axis: 'j5', dir: '-' },
    '[': { axis: 'j6', dir: '+' }, "'": { axis: 'j6', dir: '-' },
  }),
}))

const cartesianKeyMap = computed<Record<string, { axis: string; dir: string }>>(() => ({
  // 保留原 YUHJ… 映射；飞行键由 resolveFlightMapping 优先处理
  y: { axis: 'x', dir: '+' }, h: { axis: 'x', dir: '-' },
  u: { axis: 'y', dir: '+' }, j: { axis: 'y', dir: '-' },
  i: { axis: 'z', dir: '+' }, k: { axis: 'z', dir: '-' },
  // Magician：R 使用 RX 的位置与快捷键（O/L）
  o: { axis: isMagician.value ? 'r' : 'rx', dir: '+' }, l: { axis: isMagician.value ? 'r' : 'rx', dir: '-' },
  // RY/RZ 仅 6 轴机型
  ...(isMagician.value ? {} : {
    p: { axis: 'ry', dir: '+' }, semicolon: { axis: 'ry', dir: '-' },
    '[': { axis: 'rz', dir: '+' }, "'": { axis: 'rz', dir: '-' },
  }),
}))

const jointShortcutHints = computed(() => [
  { label: 'J1', pos: 'Y', neg: 'H' },
  { label: 'J2', pos: 'U', neg: 'J' },
  { label: 'J3', pos: 'I', neg: 'K' },
  { label: 'J4', pos: 'O', neg: 'L' },
  ...(isMagician.value ? [] : [
    { label: 'J5', pos: 'P', neg: ';' },
    { label: 'J6', pos: '[', neg: "'" },
  ]),
])

const cartesianShortcutHints = computed(() => {
  // WASD + 方向键提示随四向模式更新；Z（Space/Shift）固定
  const m = FLIGHT_XY_MODE_MAP[wasdDir.value]
  const arrowOf = (k: string) =>
    ({ arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' } as const)[k] ?? k.toUpperCase()
  const fmt = (axis: string, dir: string) =>
    Object.entries(m).filter(([, v]) => v.axis === axis && v.dir === dir)
      .map(([k]) => arrowOf(k)).join(' / ')
  return [
    { label: 'X', pos: fmt('x', '+'), neg: fmt('x', '-') },
    { label: 'Y', pos: fmt('y', '+'), neg: fmt('y', '-') },
    { label: 'Z', pos: 'Space / = / +', neg: 'Shift / - / _' },
    // Magician：R 使用 RX 的位置与快捷键（O/L）
    { label: isMagician.value ? 'R' : 'RX', pos: 'O', neg: 'L' },
    ...(isMagician.value ? [] : [
      { label: 'RY', pos: 'P', neg: ';' },
      { label: 'RZ', pos: '[', neg: "'" },
    ]),
  ]
})

/** 关节模式下也提示飞行键（XYZ） */
const jointWithFlightHints = computed(() => [
  ...cartesianShortcutHints.value.slice(0, 3),
  ...jointShortcutHints.value,
])

const activeKeyMap = computed(() =>
  jogCoordinate.value === 'joint' ? jointKeyMap.value : cartesianKeyMap.value
)
const activeShortcutHints = computed(() =>
  jogCoordinate.value === 'joint' ? jointWithFlightHints.value : cartesianShortcutHints.value
)

const keysDown = new Set<string>()

function isJogHotkey(key: string): boolean {
  return Boolean(FLIGHT_KEY_BASE[key] || jointKeyMap.value[key] || cartesianKeyMap.value[key])
}

/** 把焦点拉回设备页，避免 F7 光标/数字框吃掉方向键 */
function focusDevicePage() {
  const page = document.querySelector('.device-page') as HTMLElement | null
  page?.focus({ preventScroll: true })
}

/** 是否处于可编辑目标（输入框/文本域/下拉/可编辑区/Monaco）——聚焦时不响应点动热键 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.closest('.monaco-editor')) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

/** 是否 移动/预设 的坐标编辑框（J1-6 / X-RZ）——R/T/Q 面板快捷键在这些框内也生效 */
function isMoveCoordInput(target: EventTarget | null): boolean {
  return !!target && target instanceof HTMLElement && target.classList.contains('move-input')
}

/** 吸盘快捷键：Z 吸取 / X 释放 / C 清错（相邻键位：抓/卸/清） */
const ES01_KEY_MAP: Record<string, 'grip' | 'release' | 'clearAlarm'> = {
  z: 'grip',
  x: 'release',
  c: 'clearAlarm',
}

/** 3D 模型内转发来的点动按键消息 */
interface JogKeyFrom3DMessage {
  type: 'keydown' | 'keyup'
  key: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** 统一的点动启动：长按去重、换轴先停、飞行键强制笛卡尔坐标系 */
function applyJogKey(key: string, mapped: { axis: string; dir: string }, flight: ReturnType<typeof resolveFlightMapping>, repeat: boolean) {
  // 长按重复：只挡光标，不重复 startJog
  if (keysDown.has(key) || repeat) {
    keysDown.add(key)
    return
  }
  keysDown.add(key)
  // 如果已经在 jog（可能是其他轴），先停
  if (jogActive.value) stopJog()
  jogAxis.value = mapped.axis

  // 飞行键强制笛卡尔坐标系；后台切换，不阻塞首包点动
  if (flight && jogCoordinate.value === 'joint') {
    jogCoordinate.value = 'cartesian'
    jogAxis.value = mapped.axis
    appliedJogCoordinate.value = null
    void applyJogCoordinate('cartesian')
  }

  startJog(mapped.dir)
}

/** 3D 模型内转发来的按键：方向键/WASD-Z（Shift/Space/-/=）点动 + B/N/M 聚焦 */
function handleJogKeyFrom3D(msg: JogKeyFrom3DMessage) {
  const key = msg.key
  const flight = resolveFlightMapping(key)
  const mapped = flight || activeKeyMap.value[key]

  if (msg.type === 'keyup') {
    // 非点动键（B/N/M 等）的松键不干预运动
    if (!mapped) return
    // 松手：清理残留并停止（与主页面 onKeyUp 一致）
    keysDown.clear()
    stopJog()
    return
  }
  // 组合键不放行，与主页面规则一致
  if (msg.ctrlKey || msg.metaKey || msg.altKey) return

  // B/N/M 面板快捷键（穿透到 3D）：B → 手动点动；N → J1；M → X（Shift 组合不触发）
  if (key === 'b' || key === 'n' || key === 'm') {
    if (!msg.repeat && !msg.shiftKey) {
      if (key === 'b') focusJogPanel()
      else if (key === 'n') jointInputRefs.value[0]?.focus()
      else poseInputRefs.value[0]?.focus()
    }
    return
  }

  if (!mapped) return
  applyJogKey(key, mapped, flight, msg.repeat)
}

function onKeyDown(e: KeyboardEvent) {
  // Esc 关闭顶层面板（设置 > 日志 > 轨迹 > Dobot+）
  if (e.key === 'Escape') {
    if (closeTopOverlay()) {
      e.preventDefault()
      return
    }
  }

  // 只在设备页活跃时处理（避免其它路由误触发）
  if (!document.querySelector('.device-page')) return

  // F9：一键处理告警面板（清除告警 / 清除警告 / 复位碰撞，按需执行；编辑框聚焦时也可用）
  if (e.key === 'F9') {
    e.preventDefault()
    if (!e.repeat) void handleAlarmPanelShortcut()
    return
  }

  const target = e.target as HTMLElement
  const key = normalizeJogKey(e)

  // Ctrl+E：使能 / 下使能（切换，等同使能开关；编辑框聚焦时也可用；Magician 无使能概念）
  if (!isMagician.value && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault()
    if (!e.repeat) void toggleEnable()
    return
  }

  // Alt+Enter：停止运动（等同点按“停止”；点动中也会一并停掉；编辑框聚焦时也可用）
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'Enter') {
    e.preventDefault()
    if (!e.repeat) {
      stopJog()
      void doStop()
    }
    return
  }

  // Alt+B/N/M：Alt+B 聚焦手动点动板块（不变）；Alt+N 读取关节并聚焦 J1；Alt+M 读取位姿并聚焦 X
  // 用 Alt 组合避免与普通按键冲突，且 Alt+字母可被网页正常拦截（Ctrl+T 等浏览器保留键不行）
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (key === 'b' || key === 'n' || key === 'm')) {
    e.preventDefault()
    if (!e.repeat) {
      if (key === 'b') focusJogPanel()
      else if (key === 'n') readJointsAndFocus()
      else readPoseAndFocus()
    }
    return
  }

  // 组合键（Ctrl/Cmd/Alt）不放行，避免 Ctrl+A/Ctrl+C 等被热键劫持
  if (e.ctrlKey || e.metaKey || e.altKey) return

  // Magician：B 被夹爪占用，仅保留 N/M 作为聚焦快捷键
  const panelShortcutKey = key === 'n' || key === 'm' || (key === 'b' && !isMagician.value)
  // 编辑框聚焦时按键交给浏览器；仅 移动/预设 坐标框内放行 B/N/M 聚焦快捷键、WASD 点动键、=/+ 与 _ 调 Z、ZXC 吸盘键、ZVXB 末端键
  // 普通 - 不点动：负数坐标输入要用
  const editable = isEditableTarget(e.target)
  const es01EditKey = hasDobotES01.value ? ES01_KEY_MAP[key] : undefined
  const magicianEditKey = isMagician.value ? MAGICIAN_EE_KEY_MAP[key] : undefined
  const jogInEdit = JOG_IN_EDIT_KEYS.has(key) || (key === 'minus' && e.shiftKey)
  if (editable && !(isMoveCoordInput(target) && (panelShortcutKey || jogInEdit || Boolean(es01EditKey) || Boolean(magicianEditKey)))) return

  // B/N/M 只聚焦、不读取：B（左）→ 手动点动板块；N → J1；M → X（Shift 组合不触发）
  if (panelShortcutKey && !e.shiftKey) {
    e.preventDefault()
    if (!e.repeat) {
      if (key === 'b') focusJogPanel()
      else if (key === 'n') jointInputRefs.value[0]?.focus()
      else poseInputRefs.value[0]?.focus()
    }
    return
  }

  // 吸盘快捷键（仅在有 ES01 时生效；长按不重复触发）
  if (hasDobotES01.value && ES01_KEY_MAP[key]) {
    e.preventDefault()
    if (!e.repeat) void doES01(ES01_KEY_MAP[key])
    return
  }

  // Magician 末端快捷键：Z/X 吸盘，V/B 夹爪
  if (isMagician.value && MAGICIAN_EE_KEY_MAP[key]) {
    e.preventDefault()
    if (!e.repeat) handleMagicianEEKey(key)
    return
  }

  // 飞行键优先（笛卡尔 X/Y/Z），任意模式下可用；WASD 方向受反转开关影响
  const flight = resolveFlightMapping(key)
  const mapped = flight || activeKeyMap.value[key]
  if (!mapped) return

  // 关键：长按 key-repeat 也必须 preventDefault，否则 F7 光标/焦点会跟着方向键跑
  e.preventDefault()
  e.stopPropagation()

  // 可聚焦按钮：blur 掉，避免下一拍又被系统焦点导航抢走
  if (target && (target.tagName === 'BUTTON' || target.isContentEditable)) {
    target.blur?.()
    focusDevicePage()
  }

  applyJogKey(key, mapped, flight, e.repeat)
}

/** 点击页面时重新聚焦，解决 3D iframe 抢焦点后按键无效 */
function onPageClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
  if (target.closest('.monaco-editor') || target.closest('iframe')) return
  ;(e.currentTarget as HTMLElement)?.focus()
}

function onKeyUp(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const key = normalizeJogKey(e)
  if (!isJogHotkey(key)) return
  // 编辑框：仅坐标框内的点动键松键才拦截（WASD/-= 已在 keydown 启动点动，必须能停）
  if (isEditableTarget(e.target) && !isMoveCoordInput(e.target)) return
  // 松手同样拦截，避免浏览器/系统光标导航吃掉 keyup
  e.preventDefault()
  e.stopPropagation()
  // 清理：滑键时旧键可能残留，松手时全部清空
  keysDown.clear()
  stopJog()
}

/** 窗口失焦时强制停止所有 jog，防止 keyup 事件丢失导致失控 */
function onWindowBlur() {
  keysDown.clear()
  if (jogActive.value) stopJog()
}

// ─── Helpers ─────────────────────────────────────

// ─── Move To Pose ──────────────────────────────

const targetPose = reactive<Record<string, number>>({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 })
const poseMoving = ref(false)
/**
 * 路径类型（与目标 joint/pose 正交）
 * - MovJ：关节空间插补（路径可弯曲）
 * - MovL：笛卡尔直线
 * 文档：两者都可接受 joint 或 pose 目标。
 */
const movePath = ref<'MovJ' | 'MovL'>('MovJ')

/**
 * 静默把当前关节/位姿填入「移动 / 预设」编辑框。
 * 返回 true 表示关节与位姿都已填上（可标记 moveTargetInit 完成）。
 * 仅有一侧数据时也会先写入，但返回 false，等下次状态再补全。
 */
function fillMoveTargetsFromState(silent = true): boolean {
  const joints = state.value.joints as Record<string, number> | undefined
  let hasJoints = false
  let hasPose = false
  if (joints) {
    for (let j = 1; j <= jointCount.value; j++) {
      moveTarget['j' + j] = Math.round((joints['j' + j] ?? 0) * 10) / 10
    }
    hasJoints = true
  }
  const pt = getCurrentCartesian()
  if (pt) {
    if (isMagician.value) {
      targetPose.x = Math.round(pt.x * 10) / 10
      targetPose.y = Math.round(pt.y * 10) / 10
      targetPose.z = Math.round(pt.z * 10) / 10
      targetPose.r = Math.round((pt.r ?? pt.rx ?? 0) * 10) / 10
    } else {
      targetPose.x = Math.round(pt.x * 10) / 10
      targetPose.y = Math.round(pt.y * 10) / 10
      targetPose.z = Math.round(pt.z * 10) / 10
      targetPose.rx = Math.round(pt.rx * 10) / 10
      targetPose.ry = Math.round(pt.ry * 10) / 10
      targetPose.rz = Math.round(pt.rz * 10) / 10
    }
    hasPose = true
  }
  const complete = hasJoints && hasPose
  if (complete && !silent) {
    toastRef.value?.info('当前坐标已读取')
  }
  return complete
}

function readCurrentPoseToTarget() {
  const pt = getCurrentCartesian()
  if (!pt) {
    toastRef.value?.error('暂无位姿数据')
    return
  }
  if (isMagician.value) {
    targetPose.x = Math.round(pt.x * 10) / 10
    targetPose.y = Math.round(pt.y * 10) / 10
    targetPose.z = Math.round(pt.z * 10) / 10
    targetPose.r = Math.round((pt.r ?? pt.rx ?? 0) * 10) / 10
  } else {
    targetPose.x = Math.round(pt.x * 10) / 10
    targetPose.y = Math.round(pt.y * 10) / 10
    targetPose.z = Math.round(pt.z * 10) / 10
    targetPose.rx = Math.round(pt.rx * 10) / 10
    targetPose.ry = Math.round(pt.ry * 10) / 10
    targetPose.rz = Math.round(pt.rz * 10) / 10
  }
  toastRef.value?.info('当前位姿已读取')
}

/** 读取当前关节（含位姿）并聚焦 J1 编辑框（快捷键 R） */
function readJointsAndFocus() {
  readCurrentJoints()
  jointInputRefs.value[0]?.focus()
}

/** 读取当前位姿并聚焦 X 编辑框（快捷键 T） */
function readPoseAndFocus() {
  readCurrentPoseToTarget()
  poseInputRefs.value[0]?.focus()
}

/** 聚焦手动点动控制板块（快捷键 Q），聚焦后即可用方向键/WASD 点动 */
function focusJogPanel() {
  jogPanelRef.value?.focus()
}

async function moveToPose() {
  if (!checkEnabled()) return
  if (moving.value || poseMoving.value) return
  const pt: TrajPoint = isMagician.value
    ? {
        x: Number(targetPose.x || 0),
        y: Number(targetPose.y || 0),
        z: Number(targetPose.z || 0),
        rx: Number(targetPose.r || 0),
        ry: 0,
        rz: Number(targetPose.r || 0),
      }
    : {
        x: Number(targetPose.x || 0),
        y: Number(targetPose.y || 0),
        z: Number(targetPose.z || 0),
        rx: Number(targetPose.rx || 0),
        ry: Number(targetPose.ry || 0),
        rz: Number(targetPose.rz || 0),
      }
  const check = checkPoseLegal(pt)
  if (!check.legal) {
    toastRef.value?.error(`安全校验失败: ${check.reason}`)
    return
  }
  poseMoving.value = true
  try {
    if (isMock) {
      // Dock：离线 IK → 关节插补动画（MovJ/MovL 在 mock 里都走关节插补可视化）
      const near = jointsFromObject(state.value.joints as Record<string, number>)
      const ik = inverseKinematics([pt.x, pt.y, pt.z, pt.rx, pt.ry, pt.rz], near)
      if (!ik.ok || !ik.joint) {
        toastRef.value?.error(`离线 IK 失败: ${ik.message}`)
        return
      }
      // 同步关节编辑框，方便对照
      setMoveTargetJoints(ik.joint)
      const ok = await mockAnimateToJoints(ik.joint)
      if (ok) toastRef.value?.success(`已到达位姿目标（${movePath.value} / dock）`)
      else toastRef.value?.info('运动已停止')
      return
    }
    // 真机：带 pose 目标（Magician 为 XYZR 四值，直接走串口 PTP；其余机型用当前关节就近选解）
    const joints = getMoveTargetJoints()
    const pose = isMagician.value
      ? [pt.x, pt.y, pt.z, pt.rx]
      : [pt.x, pt.y, pt.z, pt.rx, pt.ry, pt.rz]
    const res = await api.movePoint(deviceId, {
      path: movePath.value,
      pose,
      joint: isMagician.value ? undefined : joints,
    })
    if (res.success) {
      const data = res.data as Record<string, unknown> | undefined
      if (data?.isAlarms) {
        toastRef.value?.error('因告警停止运动')
      } else if (data?.stopped) {
        toastRef.value?.info('运动已停止')
      } else {
        toastRef.value?.success(`已到达位姿目标（${movePath.value}）`)
      }
    } else {
      toastRef.value?.error(`移动失败: ${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`移动错误: ${(err as Error).message}`)
  } finally {
    poseMoving.value = false
  }
}

/** 姿态角规范化：把 ±180 等价角显示为更接近 0 的一侧，避免 -180/180 跳动 */
function normalizeEulerDeg(v: number): number {
  let a = v
  // 归一到 (-180, 180]
  a = ((a + 180) % 360 + 360) % 360 - 180
  if (a === -180) a = 180
  return a
}

function getPoseVal(axis: string): string {
  const pose = state.value.pose as Record<string, number> | undefined
  let val = pose?.[axis]
  // r 兼容旧字段
  if (val == null && axis === 'rx') val = pose?.r
  if (val == null) return '--.--'
  if (axis === 'rx' || axis === 'ry' || axis === 'rz' || axis === 'r') {
    return normalizeEulerDeg(val).toFixed(2)
  }
  return val.toFixed(2)
}

// ─── 位姿复制（逗号分隔）────────────────────────────

/** 当前位姿是否可读（各轴均有值） */
const poseAvailable = computed(() => poseAxes.value.every(a => getPoseVal(a) !== '--.--'))

async function copyCurrentPose() {
  if (!poseAvailable.value) {
    toastRef.value?.error('暂无位姿数据')
    return
  }
  const text = poseAxes.value.map(a => getPoseVal(a)).join(', ')
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板 API 不可用（非安全上下文等）时降级用 execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (!ok) {
      toastRef.value?.error('复制失败')
      return
    }
  }
  toastRef.value?.success(`已复制：${text}`)
}
function getJoint(n: number): string {
  const joints = state.value.joints as Record<string, number> | undefined
  const val = joints?.[`j${n}`]
  return val != null ? val.toFixed(2) : '--.--'
}
function jointPercent(n: number): number {
  const joints = state.value.joints as Record<string, number> | undefined
  const val = joints?.[`j${n}`]
  if (val == null) return 50
  return Math.max(5, Math.min(95, ((val + 180) / 360) * 100))
}

function getAxisValue(): number {
  if (jogAxis.value.startsWith('j')) {
    const joints = state.value.joints as Record<string, number> | undefined
    return joints?.[jogAxis.value] ?? 0
  }
  const pose = state.value.pose as Record<string, number> | undefined
  // r 兼容旧别名，映射到 rx
  const key = jogAxis.value === 'r' ? 'rx' : jogAxis.value
  return pose?.[key] ?? 0
}

// ─── 标定辅助（图像坐标 ↔ 物理坐标）──────────────────

const CALIB_STORAGE_KEY = `docat:calib:${deviceId}`
const calibMode = ref(false)
/** 标定面板是否激活：Magician 强制显示标定辅助（无 3D 模型） */
const calibPanelActive = computed(() => isMagician.value || calibMode.value)
const calibModel = ref<CalibModel>('affine')
const calibWeightFn = ref<WeightFn>('lsq')
const calibRansacThresh = ref(1)
const calibRowCount = ref(9)
const calibRows = ref<CalibPoint[]>([])
const calibFit = ref<CalibResult | null>(null)
const calibConvertInput = ref('')
const calibConvertResult = ref('')
const calibConvertRaw = ref<{ x: number; y: number } | null>(null)
const calibConvertDirty = ref(false)
const calibFileInputRef = ref<HTMLInputElement | null>(null)
const calibImportMode = ref<'image' | 'full'>('image')
const calibPasteOpen = ref(false)
const calibPasteText = ref('')
const calibPasteRef = ref<HTMLTextAreaElement | null>(null)
const calibPasteMode = ref<'image' | 'full'>('image')

const calibModelLabel = computed(() => calibModel.value === 'affine' ? '仿射' : '透视')
const calibWeightLabel = computed(() => {
  const map: Record<WeightFn, string> = { lsq: '最小二乘', huber: 'Huber', tukey: 'Tukey', ransac: 'RANSAC' }
  return map[calibWeightFn.value]
})
const hasLivePose = computed(() => getCurrentCartesian() !== null)

/** 行是否参与拟合（图像/物理坐标四值均有效） */
function isRowActiveInFit(i: number): boolean {
  const r = calibRows.value[i]
  if (!r) return false
  return [r.imgX, r.imgY, r.physX, r.physY].every(v => Number.isFinite(v))
}

/** 未参与拟合（缺数据）的行索引集合，用于样式置灰 */
const calibInactiveSet = computed<Record<number, boolean>>(() => {
  const set: Record<number, boolean> = {}
  calibRows.value.forEach((_, i) => {
    if (!isRowActiveInFit(i)) set[i] = true
  })
  return set
})

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

function newCalibRow(): CalibPoint {
  return { imgX: 0, imgY: 0, physX: 0, physY: 0, angle: 0 }
}

function syncCalibRows() {
  const target = Math.max(1, Math.min(99, Math.floor(Number(calibRowCount.value) || 1)))
  calibRowCount.value = target
  while (calibRows.value.length < target) calibRows.value.push(newCalibRow())
  if (calibRows.value.length > target) calibRows.value.splice(target)
}

function toggleCalibMode() {
  calibMode.value = !calibMode.value
}

function triggerCalibImport(mode: 'image' | 'full') {
  calibImportMode.value = mode
  calibFileInputRef.value?.click()
}

function onCalibFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const full = calibImportMode.value === 'full'
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result ?? '')
    if (/\.xml$/i.test(file.name) || text.trimStart().startsWith('<')) {
      applyCalibXmlImport(text, full)
      return
    }
    const fullPoints = parseCalibTxtFull(text)
    if (fullPoints.length === 0) {
      toastRef.value?.error('未解析到有效数据（每行至少两个数值）')
      return
    }
    if (fullPoints.length > calibRows.value.length) {
      calibRowCount.value = fullPoints.length
      syncCalibRows()
    }
    const points = full ? fullPoints : parseCalibTxt(text)
    points.forEach((p, i) => {
      const row = calibRows.value[i]
      if (!row) return
      row.imgX = p.imgX
      row.imgY = p.imgY
      if (full) {
        row.physX = (p as CalibPoint).physX
        row.physY = (p as CalibPoint).physY
        row.angle = (p as CalibPoint).angle
      }
    })
    toastRef.value?.success(`已导入 ${points.length} 行${full ? '（全部数据）' : '（仅图像坐标）'}`)
  }
  reader.readAsText(file)
}

/** 解析 Dobot 标定 XML（CalibInfo），提取 ImagePointLst / WorldPointLst */
function parseCalibXmlText(text: string): CalibPoint[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const readList = (name: string): Array<{ x: number; y: number; r: number }> => {
    const list = doc.querySelector(`CalibPointFListParam[ParamName="${name}"]`)
    if (!list) return []
    return Array.from(list.querySelectorAll('PointF')).map(pf => ({
      x: Number(pf.querySelector('X')?.textContent ?? NaN),
      y: Number(pf.querySelector('Y')?.textContent ?? NaN),
      r: Number(pf.querySelector('R')?.textContent ?? NaN),
    }))
  }
  const img = readList('ImagePointLst')
  const world = readList('WorldPointLst')
  const n = Math.max(img.length, world.length)
  const rows: CalibPoint[] = []
  for (let i = 0; i < n; i++) {
    rows.push({
      imgX: img[i]?.x ?? 0,
      imgY: img[i]?.y ?? 0,
      physX: world[i]?.x ?? 0,
      physY: world[i]?.y ?? 0,
      angle: img[i]?.r ?? world[i]?.r ?? 0,
    })
  }
  return rows
}

function applyCalibXmlImport(text: string, full: boolean) {
  const points = parseCalibXmlText(text)
  if (points.length === 0) {
    toastRef.value?.error('未解析到有效 XML 标定点')
    return
  }
  if (points.length > calibRows.value.length) {
    calibRowCount.value = points.length
    syncCalibRows()
  }
  points.forEach((p, i) => {
    const row = calibRows.value[i]
    if (!row) return
    row.imgX = p.imgX
    row.imgY = p.imgY
    if (full) {
      row.physX = p.physX
      row.physY = p.physY
      row.angle = p.angle
    }
  })
  toastRef.value?.success(`已从 XML 导入 ${points.length} 行${full ? '（全部数据）' : '（仅图像坐标）'}`)
}

async function startClipboardImport(mode: 'image' | 'full') {
  calibPasteMode.value = mode
  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText()
      if (text && text.trim()) {
        applyClipboardText(text, mode)
        return
      }
      toastRef.value?.info('剪贴板没有文本内容（图片/图标暂不支持 OCR）')
    }
  } catch {
    // 权限拒绝或非安全上下文，走粘贴框回退
  }
  openCalibPasteBox()
}

function openCalibPasteBox() {
  calibPasteText.value = ''
  calibPasteOpen.value = true
  void nextTick(() => calibPasteRef.value?.focus())
}

function confirmCalibPaste() {
  const text = calibPasteText.value
  calibPasteOpen.value = false
  if (!text || !text.trim()) {
    toastRef.value?.error('粘贴内容为空')
    return
  }
  applyClipboardText(text, calibPasteMode.value)
}

function cancelCalibPaste() {
  calibPasteOpen.value = false
  calibPasteText.value = ''
}

/** 应用剪贴板 OCR 数据：列优先排列（图X×n、图Y×n、[物理X×n、物理Y×n、角度×n]），数量必须等于当前行数 */
function applyClipboardText(text: string, mode: 'image' | 'full') {
  const tokens = parseNumericTokens(text)
  if (!tokens) {
    toastRef.value?.error('剪贴板含非数值数据，已中断导入')
    return
  }
  const n = Math.max(1, Math.floor(Number(calibRowCount.value) || 1))
  const cols = mode === 'full' ? 5 : 2
  if (tokens.length !== cols * n) {
    toastRef.value?.error(`数据数量不符：期望 ${cols * n} 个（${cols} 列 × 当前行数 ${n}），实际 ${tokens.length} 个`)
    return
  }
  if (calibRows.value.length !== n) {
    calibRowCount.value = n
    syncCalibRows()
  }
  calibRows.value.forEach((row, i) => {
    row.imgX = tokens[i]
    row.imgY = tokens[n + i]
    if (mode === 'full') {
      row.physX = tokens[2 * n + i]
      row.physY = tokens[3 * n + i]
      row.angle = tokens[4 * n + i]
    }
  })
  toastRef.value?.success(`已从剪贴板导入 ${n} 行${mode === 'full' ? '（全部数据）' : '（仅图像坐标）'}`)
}

// ─── 导出 & 导出目录设置 ─────────────────────────

const calibExportDir = ref('')
const savingCalibExportDir = ref(false)
const openingCalibExportDir = ref(false)

function fmtExportNum(v: number): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.000'
  return n.toFixed(3)
}

function buildCalibExportText(): string {
  const cols = calibExportRows().map(r => [
    fmtExportNum(r.imgX),
    fmtExportNum(r.imgY),
    fmtExportNum(r.physX),
    fmtExportNum(r.physY),
    fmtExportNum(r.angle),
  ])
  const widths = [0, 0, 0, 0, 0]
  cols.forEach(r => r.forEach((v, i) => {
    if (v.length > widths[i]) widths[i] = v.length
  }))
  return cols.map(r => r.map((v, i) => v.padEnd(widths[i])).join('   ')).join('\r\n') + '\r\n'
}

function calibExportRows(): api.CalibrationExportRow[] {
  return calibRows.value.map(r => ({ imgX: r.imgX, imgY: r.imgY, physX: r.physX, physY: r.physY, angle: r.angle }))
}

function calibExportStem(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const safeName = (device.value?.name || deviceId).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').slice(0, 40) || 'device'
  return `calib_${safeName}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 从 API 响应中提取错误信息（兼容标准 error 与 Fastify 的 {message} 形式） */
function apiErrorText(res: { error?: { message?: string }; message?: string } | undefined): string {
  if (!res) return '无响应'
  return res.error?.message || res.message || '未知错误'
}

async function exportCalibrationToServer() {
  if (calibRows.value.length === 0) {
    toastRef.value?.error('没有可导出的标定数据')
    return
  }
  const res = await api.exportCalibration(deviceId, calibExportRows(), device.value?.name)
  if (res.success && res.data) {
    toastRef.value?.success(`已导出到 ${res.data.path}`)
  } else {
    toastRef.value?.error(`导出失败: ${apiErrorText(res)}`)
  }
}

function downloadCalibration() {
  if (calibRows.value.length === 0) {
    toastRef.value?.error('没有可导出的标定数据')
    return
  }
  const blob = new Blob([buildCalibExportText()], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${calibExportStem()}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toastRef.value?.success(`已下载 ${a.download}`)
}

function downloadCalibrationXml() {
  if (calibRows.value.length === 0) {
    toastRef.value?.error('没有可导出的标定数据')
    return
  }
  const xml = buildCalibXml(calibRows.value, calibFit.value)
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${calibExportStem()}.xml`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toastRef.value?.success(`已下载 ${a.download}`)
}

async function exportCalibrationXmlToServer() {
  if (calibRows.value.length === 0) {
    toastRef.value?.error('没有可导出的标定数据')
    return
  }
  const xml = buildCalibXml(calibRows.value, calibFit.value)
  const res = await api.exportCalibrationXml(deviceId, xml, device.value?.name)
  if (res.success && res.data) {
    toastRef.value?.success(`已导出到 ${res.data.path}`)
  } else {
    toastRef.value?.error(`导出失败: ${apiErrorText(res)}`)
  }
}

async function loadCalibExportDir() {
  const res = await api.getSystemSettings()
  if (res.success && res.data) {
    calibExportDir.value = res.data.calibExportDir ?? ''
  }
}

async function saveCalibExportDir() {
  const dir = calibExportDir.value.trim()
  if (!dir) {
    toastRef.value?.error('请填写导出目录')
    return
  }
  savingCalibExportDir.value = true
  try {
    const res = await api.saveSystemSettings({ calibExportDir: dir })
    if (res.success) {
      toastRef.value?.success('导出目录已保存')
    } else {
      toastRef.value?.error(`保存失败: ${res.error?.message}`)
    }
  } finally {
    savingCalibExportDir.value = false
  }
}

async function openCalibExportDir() {
  const dir = calibExportDir.value.trim()
  if (!dir) {
    toastRef.value?.error('请先填写导出目录')
    return
  }
  openingCalibExportDir.value = true
  try {
    const res = await api.openExportDir(dir)
    if (res.success && res.data) {
      toastRef.value?.success(`已用${res.data.opener}打开 ${res.data.path}`)
    } else {
      toastRef.value?.error(`打开失败: ${apiErrorText(res)}`)
    }
  } finally {
    openingCalibExportDir.value = false
  }
}

function readCurrentXY(i: number) {
  const pt = getCurrentCartesian()
  if (!pt) {
    toastRef.value?.error('暂无位姿数据')
    return
  }
  calibRows.value[i].physX = round3(pt.x)
  calibRows.value[i].physY = round3(pt.y)
}

function refitCalib() {
  const pts = calibRows.value.filter((r, i) => isRowActiveInFit(i))
  if (pts.length === 0) {
    calibFit.value = null
    return
  }
  calibFit.value = fitCalibration(pts, calibModel.value, calibWeightFn.value, { ransacThreshold: Number(calibRansacThresh.value) || 1 })
  persistCalib()
}

const calibFitHint = computed(() => {
  if (!calibFit.value) return '拟合所需点数不足（仿射≥3 / 透视≥4）'
  if (!calibFit.value.usable) return '拟合失败：所需点数不足'
  return '拟合残差均方根 (mm)，越小越准'
})

/** 解析坐标对：逗号/分号或任意个数空格（含混用）分隔，取前两个数值 */
function parseCoordPair(text: string): number[] {
  return text.split(/[\s,，;；]+/).map(Number).filter(Number.isFinite)
}

function runCalibConvert() {
  if (!calibFit.value || !calibFit.value.usable) {
    toastRef.value?.error('拟合不可用：请先录入足够的标定点')
    return
  }
  const parts = parseCoordPair(calibConvertInput.value)
  if (parts.length < 2) {
    toastRef.value?.error('请输入图像坐标，用逗号或空格分隔，如 928.389 825.358 或 928.389,825.358')
    return
  }
  const r = applyCalibration(calibFit.value, parts[0], parts[1])
  calibConvertRaw.value = { x: r.x, y: r.y }
  calibConvertDirty.value = false
  calibConvertResult.value = `${r.x.toFixed(6)},${r.y.toFixed(6)}`
}

function onCalibResultKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || !(e.shiftKey || e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  void runCalibToPosition()
}

async function runCalibToPosition() {
  if (!isConnected.value) {
    toastRef.value?.error('设备未连接')
    return
  }
  const raw = calibConvertRaw.value
  const parts = raw && !calibConvertDirty.value
    ? [raw.x, raw.y]
    : parseCoordPair(calibConvertResult.value)
  if (parts.length < 2) {
    toastRef.value?.error('没有可用的物理坐标结果')
    return
  }
  const cur = getCurrentCartesian()
  targetPose.x = round6(parts[0])
  targetPose.y = round6(parts[1])
  if (cur) {
    targetPose.z = round3(cur.z)
    targetPose.rx = round3(cur.rx)
    targetPose.ry = round3(cur.ry)
    targetPose.rz = round3(cur.rz)
  } else {
    targetPose.z = 0
    targetPose.rx = 0
    targetPose.ry = 0
    targetPose.rz = 0
  }
  await moveToPose()
}

function persistCalib() {
  try {
    localStorage.setItem(CALIB_STORAGE_KEY, JSON.stringify({
      rows: calibRows.value,
      rowCount: calibRowCount.value,
      model: calibModel.value,
      weightFn: calibWeightFn.value,
      ransacThresh: calibRansacThresh.value,
    }))
  } catch (err) {
    // localStorage 不可用时忽略
  }
}

function loadCalib() {
  try {
    const raw = localStorage.getItem(CALIB_STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as {
        rows?: CalibPoint[]
        rowCount?: number
        model?: CalibModel
        weightFn?: WeightFn
        ransacThresh?: number
      }
      if (Array.isArray(data.rows)) {
        calibRows.value = data.rows.map(r => ({ imgX: r.imgX, imgY: r.imgY, physX: r.physX, physY: r.physY, angle: r.angle ?? 0 }))
        calibRowCount.value = Math.max(1, calibRows.value.length)
      }
      if (data.model === 'affine' || data.model === 'homography') calibModel.value = data.model
      if (data.weightFn === 'lsq' || data.weightFn === 'huber' || data.weightFn === 'tukey' || data.weightFn === 'ransac') calibWeightFn.value = data.weightFn
      if (typeof data.ransacThresh === 'number' && Number.isFinite(data.ransacThresh) && data.ransacThresh > 0) calibRansacThresh.value = data.ransacThresh
    }
  } catch {
    // 解析失败时使用默认值
  }
  syncCalibRows()
  refitCalib()
}

watch([calibRows, calibModel, calibWeightFn, calibRansacThresh], () => refitCalib(), { deep: true })
onMounted(loadCalib)

// ─── Load / Connect ──────────────────────────────

async function load() {
  if (isMock) {
    device.value = deviceStore.getDevice(deviceId)
    enabled.value = true
    loadPostures()
    return
  }
  const res = await api.listDevices()
  if (res.success && res.data) {
    deviceStore.setDevices(res.data)
    device.value = res.data.find(d => d.id === deviceId) ?? null
  }
  try {
    const s = await api.getDeviceStatus(deviceId)
    if (s.success && s.data) {
      const statusData = s.data as Record<string, unknown>
      deviceStore.setConnected(deviceId, s.data.connected, (statusData.mode as 'exclusive' | 'virtual') ?? null)
      if (s.data.state) {
        state.value = s.data.state
        deviceStore.setState(deviceId, s.data.state)
      }
      // Init enabled state
      const status = s.data.status as Record<string, unknown> | undefined
      enabled.value = status?.mode === 'auto'
      deviceStore.setEnabled(deviceId, enabled.value)
      // Parse alarm info（先用 exchange 轻量数据立刻上屏，再拉完整详情）
      applyRealtimeAlarms(statusData.alarms)
      applyRealtimeWarnings(statusData.warningList)
      isCollision.value = (statusData.isCollision as boolean) || false
      protectiveStop.value = (statusData.protectiveStop as boolean) || false
      emergencyStop.value = (statusData.emergencyStop as boolean) || false
      if (statusData.coordinate !== undefined) {
        syncJogCoordinateFromController(statusData.coordinate)
      }
      // 始终拉一次完整告警/警告详情，避免“日志有、主界面无”
      fetchDeviceLogs()
    }
  } catch { /* ignore */ }
  loadPostures()
  loadDobotPlusList()
}

async function doConnect(mode: 'exclusive' | 'virtual' = 'exclusive') {
  if (isMock) {
    deviceStore.setConnected(deviceId, true, 'exclusive')
    enabled.value = true
    toastRef.value?.success('[Mock] 设备已连接')
    return
  }
  connecting.value = true
  try {
    const res = await api.connectDevice(deviceId, mode)
    if (res.success) {
      deviceStore.setConnected(deviceId, true, mode)
      toastRef.value?.success(mode === 'virtual' ? '虚拟连接成功（未占用设备）' : '设备已连接 — 请上电后使能')
      // 预热点动坐标系/模式，减少首按延迟
      ensureJogReadyBackground()
    } else {
      const msg = res.error?.message ?? ''
      const code = res.error?.code
      if (code === 1001 || msg.includes('occupied') || msg.includes('无法连接')) {
        if (res.error?.status === 'occupied') {
          toastRef.value?.error(msg, {
            duration: 10000,
            action: { label: 'vConnect', variant: 'virtual', handler: () => doConnect('virtual') },
          })
        } else {
          toastRef.value?.error(msg)
        }
      } else {
        toastRef.value?.error(`连接失败：${msg}`)
      }
    }
  } finally { connecting.value = false }
}

// ─── Auto/Manual Mode ─────────────────────────────

async function toggleAutoModeEnabled() {
  if (modeSwitching.value || !isConnected.value) return
  modeSwitching.value = true
  const newVal = !autoModeEnabled.value
  try {
    const res = await api.setAutoManualSwitch(deviceId, newVal)
    if (res.success) {
      autoModeEnabled.value = newVal
      if (!newVal && isAutoMode.value) setMode('manual')
    } else {
      toastRef.value?.error(`切换失败：${res.error?.message ?? '未知错误'}`)
    }
  } catch (err) {
    toastRef.value?.error(`切换失败：${(err as Error).message}`)
  } finally { modeSwitching.value = false }
}
async function setMode(mode: 'auto' | 'manual') {
  if (!isConnected.value || modeSwitching.value) return
  if (!autoModeEnabled.value && mode === 'auto') { toastRef.value?.error('请先开启手动自动开关'); return }
  modeSwitching.value = true
  try {
    const res = await api.setAutoManualMode(deviceId, mode)
    if (res.success) {
      isAutoMode.value = mode === 'auto'
    } else {
      toastRef.value?.error(`模式切换失败：${res.error?.message ?? '未知错误'}`)
    }
  } catch (err) {
    toastRef.value?.error(`模式切换失败：${(err as Error).message}`)
  } finally { modeSwitching.value = false }
}
async function setDeviceMode(mode: 'online' | 'tcp') {
  if (!isConnected.value) { toastRef.value?.error('请先连接设备'); return }
  // 参考 OpenDobot46: checkNotRunningOrAutoModeTipThrottle
  // 文档要求手动/自动模式激活时无法切换设备模式
  if (isAutoMode.value) { toastRef.value?.error('自动模式下无法切换设备模式'); return }
  if (modeSwitching.value) return
  modeSwitching.value = true
  try {
    // 使用 /settings/function/remoteControl 端点（非 remoteSwitch）
    // 参考 OpenDobot46: POST { mode: 'tp' | 'tcp' }
    const res = await api.setRemoteControl(deviceId, mode)
    if (res.success) {
      isOnlineMode.value = mode === 'online'
    } else {
      toastRef.value?.error(`设备模式切换失败：${res.error?.message ?? '未知错误'}`)
    }
  } catch (err) {
    toastRef.value?.error(`设备模式切换失败：${(err as Error).message}`)
  } finally { modeSwitching.value = false }
}

// ─── Speed ────────────────────────────────────────

const isDraggingSpeed = ref(false)

function onSpeedInput() {
  // @input 实时更新本地值（v-model 已处理），不发请求
}

function onSpeedPointerUp() {
  isDraggingSpeed.value = false
  if (!isConnected.value) return
  // Mock 模式：比例只作用于本地模拟动画，无需请求设备
  if (isMock) return
  if (speedDebounceTimer) clearTimeout(speedDebounceTimer)
  api.setDeviceSpeed(deviceId, speedRatio.value).then(res => {
    if (!res.success) {
      toastRef.value?.error(`设置速度失败：${res.error?.message}`)
    }
  }).catch(() => {})
}

async function loadSpeed() {
  if (isMock) return
  if (!isConnected.value) return
  try {
    const res = await api.getDeviceSpeed(deviceId)
    if (res.success && res.data) {
      speedRatio.value = res.data.ratio
    }
  } catch { /* ignore */ }
}

// ─── Power / Enable ──────────────────────────────

async function doPowerOn() {
  try {
    const res = await api.powerOnDevice(deviceId)
    if (res.success) {
      toastRef.value?.success('伺服已上电')
    } else {
      toastRef.value?.error(`上电失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`上电出错：${(err as Error).message}`)
  }
}

async function doPowerOff() {
  try {
    const res = await api.powerOffDevice(deviceId)
    if (res.success) {
      enabled.value = false
      deviceStore.setEnabled(deviceId, false)
      toastRef.value?.info('伺服已下电')
    } else {
      toastRef.value?.error(`下电失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`下电出错：${(err as Error).message}`)
  }
}

async function toggleEnable() {
  if (enabled.value) {
    await doDisable()
  } else {
    await doEnable()
  }
}

function checkEnabled(): boolean {
  // Magician 无使能概念，始终放行
  if (isMagician.value) return true
  if (!enabled.value) {
    toastRef.value?.error('请先使能设备')
    return false
  }
  return true
}

async function doEnable() {
  enabling.value = true
  try {
    if (isMock) {
      enabled.value = true
      deviceStore.setEnabled(deviceId, true)
      if (state.value) state.value = { ...state.value, status: { connected: true, mode: 'auto' } }
      toastRef.value?.success('机器人已使能（Mock）')
      return
    }
    toastRef.value?.info('使能中...（可能需要切换示教器开关）')
    const res = await api.enableDevice(deviceId)
    if (res.success) {
      enabled.value = true
      deviceStore.setEnabled(deviceId, true)
      toastRef.value?.success('机器人已使能 — 可开始运动')
    } else {
      toastRef.value?.error(`使能失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`使能出错：${(err as Error).message}`)
  } finally {
    enabling.value = false
  }
}

async function doDisable() {
  try {
    if (isMock) {
      enabled.value = false
      deviceStore.setEnabled(deviceId, false)
      if (state.value) state.value = { ...state.value, status: { connected: true, mode: 'manual' } }
      toastRef.value?.info('机器人已去使能（Mock）')
      return
    }
    const res = await api.disableDevice(deviceId)
    if (res.success) {
      enabled.value = false
      deviceStore.setEnabled(deviceId, false)
      toastRef.value?.info('机器人已去使能')
    } else {
      toastRef.value?.error(`去使能失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`去使能出错：${(err as Error).message}`)
  }
}

// ─── Lock / Subscribe ────────────────────────────

async function doClearAlarm() {
  try {
    const res = await api.clearAlarm(deviceId)
    if (res.success) {
      currentAlarms.value = []
      // 清除后立即刷新完整列表，同步主界面与日志面板
      await fetchDeviceLogs()
      if (isMagician.value) {
        // Magician：告警后串口链路可能异常，清除后自动重连恢复（E6 不重连）
        toastRef.value?.info('告警已清除，正在重新连接设备…')
        await api.disconnectDevice(deviceId).catch(() => {})
        await new Promise((r) => setTimeout(r, 300))
        await doConnect()
      } else {
        toastRef.value?.success('告警已清除')
      }
    } else {
      toastRef.value?.error(`清除告警失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`清除告警出错：${(err as Error).message}`)
  }
}

/** 清除警告（仅清主界面显示；控制器无清除接口，下次状态更新会重新同步） */
function dismissWarnings() {
  if (currentWarnings.value.length === 0) {
    toastRef.value?.info('当前没有警告')
    return
  }
  currentWarnings.value = []
  rebuildDeviceLogsFromPanels()
  toastRef.value?.success('警告已清除')
}

/** F9：清除告警（按钮常显，始终下发）——最后清本地警告显示、复位碰撞 */
async function handleAlarmPanelShortcut() {
  await doClearAlarm()
  if (isCollision.value) {
    await doResetCollision()
  }
  // 警告只清本地显示，放在最后，避免被上面的设备刷新重新带回来
  if (currentWarnings.value.length > 0) {
    dismissWarnings()
  }
}

async function doResetCollision() {
  try {
    const res = await api.resetCollision(deviceId)
    if (res.success) {
      isCollision.value = false
      toastRef.value?.success('碰撞已复位')
    } else {
      toastRef.value?.error(`复位碰撞失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`复位碰撞出错：${(err as Error).message}`)
  }
}

// ─── Jog Control ────────────────────────────────

async function changeJogMode(mode: 'continuous' | 'step') {
  jogMode.value = mode
  if (!isConnected.value) return
  if (mode === 'continuous') {
    await applyJogMode()
  } else {
    await applyTeachInch()
  }
  // 模式就绪后预热，保证下次按键无额外等待
  ensureJogReadyBackground()
}

/** 切换关节 / 笛卡尔点动坐标系（对应控制器 /interface/coordinate） */
async function changeJogCoordinate(mode: JogCoordinateMode) {
  if (jogCoordinate.value === mode || jogCoordSwitching.value) return
  if (jogActive.value) stopJog()

  const prev = jogCoordinate.value
  jogCoordinate.value = mode
  // 切换坐标系时重置当前轴与幅度起点，避免跨空间误用
  jogAxis.value = mode === 'joint' ? 'j1' : 'x'
  appliedJogCoordinate.value = null

  if (!isConnected.value || isMock) {
    appliedJogCoordinate.value = mode
    return
  }

  jogCoordSwitching.value = true
  try {
    const ok = await applyJogCoordinate(mode)
    if (!ok) {
      jogCoordinate.value = prev
      jogAxis.value = prev === 'joint' ? 'j1' : 'x'
    } else {
      // 预热点动模式，减少下次按键等待
      ensureJogReadyBackground()
    }
  } finally {
    jogCoordSwitching.value = false
  }
}

async function applyJogCoordinate(mode: JogCoordinateMode = jogCoordinate.value): Promise<boolean> {
  if (isMock) {
    appliedJogCoordinate.value = mode
    return true
  }
  if (appliedJogCoordinate.value === mode) return true
  const res = await api.setJogCoordinate(deviceId, mode)
  if (res.success) {
    appliedJogCoordinate.value = mode
    return true
  }
  toastRef.value?.error(`切换坐标系失败：${res.error?.message}`)
  return false
}

/** 从控制器状态同步当前坐标系（0=joint, 非0=cartesian） */
function syncJogCoordinateFromController(raw: unknown) {
  if (jogActive.value || jogCoordSwitching.value) return
  let next: JogCoordinateMode | null = null
  if (typeof raw === 'number') {
    next = raw === 0 ? 'joint' : 'cartesian'
  } else if (typeof raw === 'string') {
    const s = raw.toLowerCase()
    if (s === 'joint') next = 'joint'
    else if (s === 'cartesian' || s === 'tool') next = s
  }
  if (!next) return
  if (jogCoordinate.value !== next) {
    jogCoordinate.value = next
  }
  // 无论是否刚切换，都保证当前轴属于当前坐标系
  const axes = next === 'joint' ? JOINT_AXES.value : CARTESIAN_AXES.value
  if (!(axes as readonly string[]).includes(jogAxis.value)) {
    jogAxis.value = next === 'joint' ? 'j1' : 'x'
  }
  appliedJogCoordinate.value = next
}

async function applyJogMode(): Promise<boolean> {
  if (isMock) { appliedJogMode.value = 'jog'; return true }
  if (appliedJogMode.value === 'jog') return true
  const res = await api.setJogMode(deviceId, 'jog')
  if (res.success) {
    appliedJogMode.value = 'jog'
    return true
  }
  toastRef.value?.error(`设置点动模式失败：${res.error?.message}`)
  return false
}

async function applyTeachInch(): Promise<boolean> {
  if (isMock) { appliedJogMode.value = 'step'; appliedTeachInch.value = jogInch.value; return true }
  const distance = Number(jogInch.value)
  if (!Number.isFinite(distance) || distance <= 0) {
    toastRef.value?.error('步长无效')
    return false
  }
  if (appliedJogMode.value !== 'step') {
    const modeRes = await api.setJogMode(deviceId, 'step')
    if (!modeRes.success) {
      toastRef.value?.error(`设置步进模式失败：${modeRes.error?.message}`)
      return false
    }
    appliedJogMode.value = 'step'
  }
  if (appliedTeachInch.value === distance) return true
  const res = await api.setTeachInch(deviceId, distance)
  if (res.success) {
    appliedTeachInch.value = distance
    return true
  } else {
    toastRef.value?.error(`设置步长失败：${res.error?.message}`)
    return false
  }
}

async function setTeachInchPreset(value: number) {
  jogInch.value = value
  await applyTeachInch()
}

/**
 * 后台预热：坐标系 / 连续点动模式
 * 不阻塞按键；首次按键若未就绪会 fire-and-forget 触发一次。
 */
function ensureJogReadyBackground() {
  if (!isConnected.value || isMock) return
  if (appliedJogCoordinate.value !== jogCoordinate.value) {
    void applyJogCoordinate()
  }
  if (jogMode.value === 'continuous' && appliedJogMode.value !== 'jog') {
    void applyJogMode()
  }
  if (jogMode.value === 'step') {
    void applyTeachInch()
  }
}

async function startJog(dir: string) {
  if (!isConnected.value) { toastRef.value?.error('设备未连接'); return }
  if (!checkEnabled()) return

  // 先停掉旧的 jog（防止重复启动）
  if (jogActive.value) stopJog()

  const gen = ++jogGeneration
  jogDir.value = dir
  jogActive.value = true

  // Record start position for amplitude protection
  jogStartPose.value = {
    ...(state.value.pose as Record<string, number>),
    ...(state.value.joints as Record<string, number>),
  }
  ampTravel.value = 0

  // 即走：首包立刻发（不排队），坐标系/模式后台预热
  ensureJogReadyBackground()
  jogTickInFlight = false
  sendJogCmd(dir, gen)

  // 轻点松手：若在首包发出前就 stop，gen 会变化，后续包自动丢弃
  if (!jogActive.value || gen !== jogGeneration) return

  if (jogMode.value === 'step') {
    // 步进：不发 stop，短时间后结束本地状态
    stepTimer.value = setTimeout(() => {
      if (gen === jogGeneration) jogActive.value = false
    }, 120)
  } else {
    // 连续续发：固定节拍，但若上一拍还在飞就跳过，避免堆积卡顿
    jogInterval.value = setInterval(() => {
      if (!jogActive.value || gen !== jogGeneration) {
        if (jogInterval.value) { clearInterval(jogInterval.value); jogInterval.value = null }
        return
      }
      if (jogTickInFlight) {
        // 上一拍未完成：只检查幅度，不叠包
        checkAmplitude()
        return
      }
      jogTickInFlight = true
      sendJogCmd(dir, gen)
      // release in-flight on next tick to avoid request pile-up
      setTimeout(() => { jogTickInFlight = false }, 0)
      checkAmplitude()
    }, JOG_REPEAT_MS)
  }
}

function enqueueJogCmd(task: () => Promise<void>) {
  jogCmdChain = jogCmdChain.then(task, task)
  return jogCmdChain
}

/**
 * 下发点动：优先 WebSocket（少一跳 HTTP），失败再 REST 降级。
 * WS 路径 fire-and-forget，不排队等待，真正做到“按即发”。
 */
function sendJogCmd(dir: string, gen: number = jogGeneration) {
  if (gen !== jogGeneration || !jogActive.value) return

  if (isMock) {
    const axis = jogAxis.value
    // 关节点动步长 °；笛卡尔平移 mm / 旋转 °
    // 连续模式按速度滑块放大步长（更快），步进模式保持固定步长
    const ratio = Math.min(100, Math.max(1, speedRatio.value || 100)) / 100
    const speedScale = jogMode.value === 'step' ? 1 : ratio
    const delta = (dir === '+' ? 0.8 : -0.8) * speedScale
    const joints = { ...(state.value.joints as Record<string, number>) }
    const pose = { ...(state.value.pose as Record<string, number>) }
    if (axis.startsWith('j')) {
      const next = applyJointDelta(joints, pose, axis, delta)
      commitMockState(next.joints, next.pose)
    } else {
      // 平移用较大步长更跟手；旋转保持与关节一致
      const cartDelta = (axis === 'x' || axis === 'y' || axis === 'z')
        ? (dir === '+' ? 2.0 : -2.0) * speedScale
        : delta
      const next = applyCartesianDelta(joints, pose, axis, cartDelta)
      if (!next.ok) {
        // 仍更新 pose 显示，但 toast 提示一次（避免连发刷屏：仅 step 模式提示）
        if (jogMode.value === 'step') {
          toastRef.value?.error(next.message || '离线 IK 无解')
        }
        commitMockState(joints, next.pose)
      } else {
        commitMockState(next.joints, next.pose)
      }
    }
    return
  }

  const axis = jogAxis.value
  const mode = jogMode.value

  // ① 优先 WS 实时通道
  if (wsClient.sendJog(deviceId, axis, dir, mode)) return

  // ② 降级 REST（串行，避免 stop 被盖）
  void enqueueJogCmd(async () => {
    if (gen !== jogGeneration || !jogActive.value) return
    try {
      await api.jogDevice(deviceId, axis, dir, mode)
    } catch (err) {
      console.error('[Jog] send failed:', err)
    }
  })
}

function stopJog() {
  if (stepTimer.value) { clearTimeout(stepTimer.value); stepTimer.value = null }
  if (jogInterval.value) { clearInterval(jogInterval.value); jogInterval.value = null }
  const wasActive = jogActive.value
  // 立刻作废所有 in-flight jog，并标为非活跃
  jogGeneration++
  jogActive.value = false
  jogTickInFlight = false
  ampTravel.value = 0
  // 连续模式：立刻发 stopJog，保证即停
  if (wasActive && jogMode.value === 'continuous') {
    sendJogStop()
  }
}

function sendJogStop() {
  if (isMock) return

  // ① 优先 WS 单次 stop（server 端会作废未发出的 jog 再清按钮）
  if (wsClient.sendJogStop(deviceId)) return

  // ② REST 降级
  void enqueueJogCmd(async () => {
    try {
      await api.stopJogDevice(deviceId)
    } catch (err) {
      console.error('[Jog] stop failed:', err)
      await api.stopDevice(deviceId).catch(() => {})
    }
  })
}

function checkAmplitude() {
  if (!jogActive.value) return // 已停止，不再检查
  const current = getAxisValue()
  const start = jogStartPose.value[jogAxis.value]
  if (start == null) return
  const delta = Math.abs(current - start)
  ampTravel.value = delta
  const limit = Number(ampLimit.value)
  // 0 或空值表示不限制，持续移动
  if (Number.isFinite(limit) && limit > 0 && delta >= limit) {
    toastRef.value?.error(`已达幅度上限：${delta.toFixed(1)} >= ${limit}`)
    stopJog()
  }
}

// ─── Motion Actions ─────────────────────────────

function setMoveTargetJoints(joints: number[]) {
  for (let j = 1; j <= jointCount.value; j++) {
    moveTarget['j' + j] = joints[j - 1] || 0
  }
}

function getMoveTargetJoints() {
  return Array.from({ length: jointCount.value }, (_, i) => Number(moveTarget['j' + (i + 1)] || 0))
}

/** 解析粘贴的坐标文本：空格/逗号/分号/回车分隔，可带首尾 [ ] 或 ( )，需恰好 count 个数值 */
function parseCoordText(text: string, count: number): number[] | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/^[[(]/, '').replace(/[\])]$/, '').trim()
  if (!cleaned) return null
  const parts = cleaned.split(/[;,\s]+/).filter(Boolean)
  if (parts.length !== count) return null
  const out: number[] = []
  for (const part of parts) {
    const v = Number(part)
    if (!Number.isFinite(v)) return null
    out.push(v)
  }
  return out
}

/** 读取剪贴板文本；权限受限/非安全上下文/空内容返回 null */
async function readClipboardText(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText()
      if (text && text.trim()) return text
    }
  } catch {
    // 权限拒绝或非安全上下文，走手动粘贴回退
  }
  return null
}

/** 把剪贴板坐标填入「移动 / 预设」关节编辑框 */
async function pasteToMoveTarget() {
  let text = await readClipboardText()
  if (text === null) {
    text = window.prompt(`无法读取剪贴板，请粘贴关节坐标（${jointCount.value} 个数值，空格/逗号分隔）：`, '')
    if (text === null || text.trim() === '') return
  }
  const values = parseCoordText(text, jointCount.value)
  if (!values) {
    toastRef.value?.error(`需恰好 ${jointCount.value} 个数值（空格/逗号分隔，可带 [ ]）`)
    return
  }
  setMoveTargetJoints(values)
  toastRef.value?.success(`已粘贴关节坐标（J1–J${jointCount.value}）`)
}

/** 把剪贴板坐标填入「移动 / 预设」位姿编辑框（Magician 4 个 XYZR，其余 6 个 XYZ+姿态角） */
async function pasteToTargetPose() {
  const count = isMagician.value ? 4 : 6
  let text = await readClipboardText()
  if (text === null) {
    text = window.prompt(`无法读取剪贴板，请粘贴位姿坐标（${count} 个数值，空格/逗号分隔）：`, '')
    if (text === null || text.trim() === '') return
  }
  const values = parseCoordText(text, count)
  if (!values) {
    toastRef.value?.error(`需恰好 ${count} 个数值（空格/逗号分隔，可带 [ ]）`)
    return
  }
  if (isMagician.value) {
    targetPose.x = values[0]
    targetPose.y = values[1]
    targetPose.z = values[2]
    targetPose.r = values[3]
  } else {
    targetPose.x = values[0]
    targetPose.y = values[1]
    targetPose.z = values[2]
    targetPose.rx = values[3]
    targetPose.ry = values[4]
    targetPose.rz = values[5]
  }
  toastRef.value?.success('已粘贴位姿坐标')
}

/** 读取当前关节值到编辑框 */
function readCurrentJoints() {
  const joints = state.value.joints as Record<string, number> | undefined
  if (!joints) {
    toastRef.value?.error('暂无关节数据')
    return
  }
  for (let j = 1; j <= jointCount.value; j++) {
    moveTarget['j' + j] = Math.round((joints['j' + j] ?? 0) * 10) / 10
  }
  // 顶部「读取」同时刷新笛卡尔，避免位姿仍是 0
  const pt = getCurrentCartesian()
  if (pt) {
    targetPose.x = Math.round(pt.x * 10) / 10
    targetPose.y = Math.round(pt.y * 10) / 10
    targetPose.z = Math.round(pt.z * 10) / 10
    if (isMagician.value) {
      targetPose.r = Math.round((pt.r ?? pt.rx ?? 0) * 10) / 10
    } else {
      targetPose.rx = Math.round(pt.rx * 10) / 10
      targetPose.ry = Math.round(pt.ry * 10) / 10
      targetPose.rz = Math.round(pt.rz * 10) / 10
    }
  }
  toastRef.value?.info(pt ? '当前关节与位姿已读取' : '当前关节值已读取')
}

/**
 * 关节目标移动：用当前路径类型（MovJ/MovL）+ joint 目标。
 * 文档允许 MovL({joint=...})，即直线路径到关节角对应位姿。
 * Dock(?mock=1)：本地离线 FK 动画，不连控制器。
 */
/** 坐标编辑框 Shift/Ctrl/Cmd+Enter → 触发对应区域的移动 */
function onMoveInputKeydown(kind: 'joint' | 'pose', e: KeyboardEvent) {
  if (e.key !== 'Enter' || !(e.shiftKey || e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  if (kind === 'joint') void doMove()
  else void moveToPose()
}

async function doMove() {
  if (!isConnected.value) { toastRef.value?.error('设备未连接'); return }
  if (!checkEnabled()) return
  if (moving.value || poseMoving.value) return

  const joints = getMoveTargetJoints()
  moving.value = true
  moveTargetJoints = joints
  try {
    if (isMock) {
      const ok = await mockAnimateToJoints(joints)
      if (ok) {
        toastRef.value?.success(`已到达 J[${joints.map(v => v.toFixed(1)).join(', ')}]（${movePath.value} / dock）`)
      } else {
        toastRef.value?.info('运动已停止')
      }
      return
    }
    const res = await api.movePoint(deviceId, {
      path: movePath.value,
      joint: joints,
    })
    if (res.success) {
      const data = res.data as Record<string, unknown> | undefined
      if (data?.isAlarms) {
        toastRef.value?.error('因告警停止运动')
      } else if (data?.stopped) {
        toastRef.value?.info('运动已停止')
      } else {
        toastRef.value?.success(`已到达 J[${joints.map(v => v.toFixed(1)).join(', ')}]（${movePath.value}）`)
      }
    } else {
      toastRef.value?.error(`移动失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`移动出错：${(err as Error).message}`)
  } finally {
    moveTargetJoints = null
    moving.value = false
    if (moveTimer.value) {
      clearTimeout(moveTimer.value)
      moveTimer.value = null
    }
  }
}

async function stopMoveJoints(showToast = true) {
  if (moveTimer.value) {
    clearTimeout(moveTimer.value)
    moveTimer.value = null
  }
  const joints = moveTargetJoints
  moveTargetJoints = null
  const wasMoving = moving.value
  moving.value = false
  if (isMock) {
    cancelMockMove()
    if (showToast && wasMoving) toastRef.value?.info('运动已停止')
    return
  }
  // 打断进行中的服务端 moveJoints：发 value:false + 通用 stop
  if (joints) {
    await api.moveJointsCommand(deviceId, joints, false).catch(() => {})
  }
  await api.stopDevice(deviceId).catch(() => {})
  if (showToast && wasMoving) {
    toastRef.value?.info('运动已停止')
  }
}

async function doHome() {
  if (!checkEnabled()) return
  try {
    const res = await api.homeDevice(deviceId)
    if (res.success) { toastRef.value?.success('开始回零') }
    else toastRef.value?.error(`回零失败：${res.error?.message}`)
  } catch (err) {
    toastRef.value?.error(`回零出错：${(err as Error).message}`)
  }
}

async function doStop() {
  if (isMock) {
    cancelMockMove()
    moving.value = false
    poseMoving.value = false
    moveTargetJoints = null
    toastRef.value?.info('运动已停止')
    return
  }
  try {
    const res = await api.stopDevice(deviceId)
    if (res.success) { toastRef.value?.info('运动已停止') }
    else toastRef.value?.error(`停止失败：${res.error?.message}`)
  } catch (err) {
    toastRef.value?.error(`停止出错：${(err as Error).message}`)
  }
}

async function doEstop() {
  try {
    const res = await api.estopDevice(deviceId)
    if (res.success) { toastRef.value?.error('急停已触发') }
    else toastRef.value?.error(`急停失败：${res.error?.message}`)
  } catch (err) {
    toastRef.value?.error(`急停出错：${(err as Error).message}`)
  }
}

function doLogout() { clearToken(); wsClient.destroy(); deviceStore.reset(); clearWorkspace(); router.push('/login') }

// ─── Load Parameters (Device Settings) ──────────

interface LoadConfigItem {
  name: string
  centerX: number
  centerY: number
  centerZ: number
  loadValue: number
}

const loadConfigs = ref<LoadConfigItem[]>([])
const loadParamsForm = reactive<LoadConfigItem>({ name: '', centerX: 0, centerY: 0, centerZ: 0, loadValue: 0 })
const addingPreset = ref(false)
const addPresetForm = reactive<LoadConfigItem>({ name: '', centerX: 0, centerY: 0, centerZ: 0, loadValue: 0 })
const editingPresetIdx = ref<number | null>(null)
const editPresetForm = reactive<LoadConfigItem>({ name: '', centerX: 0, centerY: 0, centerZ: 0, loadValue: 0 })
const loadingLoadData = ref(false)
const loadParamsEditable = computed(() => isConnected.value && !loadingLoadData.value)

/** 当前机型最大负载（g），未知机型为 null */
const maxLoadG = computed(() => maxLoadGramsForDevice(device.value?.type || device.value?.name))

/** 负载表单校验：重量 ≤ 机型最大负载，质心偏移 ±1000mm（对齐 OpenDobot46 ruler） */
function validateLoadForm(form: { loadValue: number; centerX: number; centerY: number; centerZ: number }): string | null {
  const weightErr = validateLoadWeight(Number(form.loadValue), device.value?.type || device.value?.name)
  if (weightErr) return weightErr
  const axes: Array<[number, string]> = [
    [Number(form.centerX), 'X'],
    [Number(form.centerY), 'Y'],
    [Number(form.centerZ), 'Z'],
  ]
  for (const [v, label] of axes) {
    const offErr = validateOffset(v)
    if (offErr) return `质心${label}${offErr}`
  }
  return null
}

// 当前负载名称：仅当与设备上的预设匹配时才视为预设挡位（自定义挡位不显示名称）
const loadBadgeName = computed(() => {
  const name = loadParamsForm.name.trim()
  if (!name) return ''
  return loadConfigs.value.some(c => c.name === name) ? name : ''
})
const loadBadgeValue = computed(() => Math.round(loadParamsForm.loadValue))
const loadBadgeText = computed(() => {
  const name = loadBadgeName.value
  return `${loadBadgeValue.value}g${name ? `(${name})` : ''}`
})
const loadBadgeTitle = computed(() => {
  const name = loadBadgeName.value
  return [
    `当前负载：${loadBadgeValue.value}g${name ? ` · ${name}` : ''}`,
    `质心 X/Y/Z：${loadParamsForm.centerX} / ${loadParamsForm.centerY} / ${loadParamsForm.centerZ} mm`,
  ].join('\n')
})

async function loadLoadData() {
  if (!isConnected.value && !isMock) return
  loadingLoadData.value = true
  try {
    if (isMock) {
      loadConfigs.value = [
        { name: 'load1', centerX: 0, centerY: 0, centerZ: 30, loadValue: 500 },
        { name: 'load2', centerX: 20, centerY: 0, centerZ: 50, loadValue: 1000 },
      ]
      Object.assign(loadParamsForm, { name: 'load1', centerX: 0, centerY: 0, centerZ: 30, loadValue: 500 })
      return
    }
    const [configRes, paramsRes] = await Promise.all([
      api.getLoadConfig(deviceId),
      api.getLoadParams(deviceId),
    ])
    if (configRes.success && configRes.data) {
      loadConfigs.value = configRes.data
    }
    if (paramsRes.success && paramsRes.data) {
      Object.assign(loadParamsForm, paramsRes.data)
    }
  } catch (err) {
    console.warn('[LoadParams] Failed to load:', err)
  } finally {
    loadingLoadData.value = false
  }
}

async function saveCurrentLoad() {
  const formErr = validateLoadForm(loadParamsForm)
  if (formErr) {
    toastRef.value?.error(formErr)
    return
  }
  try {
    if (isMock) {
      toastRef.value?.success('负载参数已应用（Mock）')
      return
    }
    const res = await api.setLoadParams(deviceId, { ...loadParamsForm })
    if (res.success) {
      toastRef.value?.success('负载参数已应用')
    } else {
      toastRef.value?.error(`应用失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`应用出错：${(err as Error).message}`)
  }
}

function applyPreset(item: LoadConfigItem) {
  Object.assign(loadParamsForm, { ...item })
  saveCurrentLoad()
}

async function saveLoadConfig() {
  if (isMock) return
  try {
    const res = await api.setLoadConfig(deviceId, [...loadConfigs.value])
    if (!res.success) {
      toastRef.value?.error(`保存预设失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`保存预设出错：${(err as Error).message}`)
  }
}

function startAddPreset() {
  addingPreset.value = true
  Object.assign(addPresetForm, { name: '', centerX: 0, centerY: 0, centerZ: 0, loadValue: 0 })
}

function cancelAddPreset() {
  addingPreset.value = false
}

async function confirmAddPreset() {
  const nameErr = validateAlias(addPresetForm.name)
  if (nameErr) {
    toastRef.value?.error(nameErr)
    return
  }
  const formErr = validateLoadForm(addPresetForm)
  if (formErr) {
    toastRef.value?.error(formErr)
    return
  }
  if (loadConfigs.value.some(c => c.name === addPresetForm.name.trim())) {
    toastRef.value?.error('预设名称已存在')
    return
  }
  loadConfigs.value.push({ ...addPresetForm, name: addPresetForm.name.trim() })
  addingPreset.value = false
  await saveLoadConfig()
  toastRef.value?.success('预设已添加')
}

function startEditPreset(idx: number) {
  editingPresetIdx.value = idx
  Object.assign(editPresetForm, loadConfigs.value[idx])
}

function cancelEditPreset() {
  editingPresetIdx.value = null
}

async function saveEditPreset(idx: number) {
  const nameErr = validateAlias(editPresetForm.name)
  if (nameErr) {
    toastRef.value?.error(nameErr)
    return
  }
  const formErr = validateLoadForm(editPresetForm)
  if (formErr) {
    toastRef.value?.error(formErr)
    return
  }
  if (loadConfigs.value.some((c, i) => i !== idx && c.name === editPresetForm.name.trim())) {
    toastRef.value?.error('预设名称已存在')
    return
  }
  loadConfigs.value[idx] = { ...editPresetForm, name: editPresetForm.name.trim() }
  editingPresetIdx.value = null
  await saveLoadConfig()
  toastRef.value?.success('预设已更新')
}

async function deletePreset(idx: number) {
  const name = loadConfigs.value[idx].name
  confirmAction(`删除负载预设「${name}」？`, async () => {
    loadConfigs.value.splice(idx, 1)
    if (editingPresetIdx.value === idx) editingPresetIdx.value = null
    await saveLoadConfig()
    toastRef.value?.success(`预设 "${name}" 已删除`)
  })
}

// Watch: reload settings data when settings panel opens / tab changes
watch(showSettings, (val) => {
  if (val) {
    // 面板打开时加载当前 tab 的数据（默认 system tab 不触发 settingsTab 变更）
    loadSettingsTabData(settingsTab.value)
  }
})

// ─── System Settings ───────────────────────────

const aliasInput = ref('')
async function loadAlias() {
  const res = await api.getDeviceAlias(deviceId)
  if (res.success && res.data) aliasInput.value = res.data.alias ?? ''
}
async function saveAlias() {
  if (!aliasInput.value.trim()) { toastRef.value?.error('请填写别名'); return }
  const res = await api.setDeviceAlias(deviceId, aliasInput.value.trim())
  if (res.success) toastRef.value?.success('别名已保存')
  else toastRef.value?.error(`保存别名失败：${res.error?.message}`)
}

const sysTimeForm = reactive({ date: '', time: '', timeZone: '' })
async function loadSystemTime() {
  const res = await api.getSystemTime(deviceId)
  if (res.success && res.data) Object.assign(sysTimeForm, res.data)
}
async function saveSystemTime() {
  const dErr = validateDate(sysTimeForm.date)
  if (dErr) { toastRef.value?.error(dErr); return }
  const tErr = validateTime(sysTimeForm.time)
  if (tErr) { toastRef.value?.error(tErr); return }
  const zErr = validateTimeZone(sysTimeForm.timeZone)
  if (zErr) { toastRef.value?.error(zErr); return }
  const res = await api.setSystemTime(deviceId, { ...sysTimeForm })
  if (res.success) toastRef.value?.success('系统时间已保存')
  else toastRef.value?.error(`保存时间失败：${res.error?.message}`)
}

function syncLocalTime() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  sysTimeForm.date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  sysTimeForm.time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  // 控制器要求 IANA 时区名（如 Asia/Shanghai），UTC+8 会被拒绝
  sysTimeForm.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  saveSystemTime()
}

// ─── 进页面时间偏差检查 ─────────────────────────

const CHECK_TIME_KEY = `docat:checkTime:${deviceId}`
const TIME_DRIFT_THRESHOLD_MS = 5 * 60 * 1000
const checkDeviceTime = ref(localStorage.getItem(CHECK_TIME_KEY) !== '0')
function persistCheckDeviceTime() {
  localStorage.setItem(CHECK_TIME_KEY, checkDeviceTime.value ? '1' : '0')
}

/** 解析设备时间为毫秒时间戳。
 * 控制器返回的 timeZone 是 IANA 名（如 Asia/Shanghai），按 OpenDobot46 convertToUTCTime 方式解析；
 * 无法解析时按浏览器本地墙钟兜底，并取最接近当前时刻的候选，避免时区语义差异导致误报 */
function parseDeviceTime(t: { date?: string; time?: string; timeZone?: string }): number | null {
  if (!t.date || !t.time) return null
  const wall = Date.parse(`${t.date} ${t.time}`)
  if (Number.isNaN(wall)) return null
  const candidates: number[] = [wall - new Date().getTimezoneOffset() * 60000]
  const tz = (t.timeZone ?? '').trim()
  if (tz) {
    try {
      const name = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts()
        .find(p => p.type === 'timeZoneName')?.value
      if (name) {
        const parsed = Date.parse(`${t.date} ${t.time} ${name}`)
        if (!Number.isNaN(parsed)) candidates.push(parsed)
      }
    } catch { /* 无效时区名，忽略 */ }
    const m = /(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?/i.exec(tz)
    if (m) {
      const off = (+m[2] * 60 + (+m[3] || 0)) * (m[1] === '-' ? -1 : 1)
      candidates.push(wall - off * 60000)
    }
  }
  const now = Date.now()
  let best = candidates[0]
  for (const c of candidates) if (Math.abs(c - now) < Math.abs(best - now)) best = c
  return best
}

function formatDrift(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} 分钟`
  return `${(min / 60).toFixed(1)} 小时`
}

function openTimeSettings() {
  showSettings.value = true
  settingsTab.value = 'docat'
}

async function checkDeviceTimeOnEntry() {
  if (!checkDeviceTime.value || isMock) return
  const res = await api.getSystemTime(deviceId)
  if (!res.success || !res.data) return
  const devMs = parseDeviceTime(res.data)
  if (devMs == null) return
  const diff = Math.abs(Date.now() - devMs)
  if (diff < TIME_DRIFT_THRESHOLD_MS) return
  toastRef.value?.error(
    `设备时间与当前时间偏差约 ${formatDrift(diff)}，建议同步`,
    {
      duration: 0,
      actions: [
        { label: '同步', handler: () => syncLocalTime() },
        { label: '提醒设置', handler: openTimeSettings },
      ],
    },
  )
}

// ─── User Management ───────────────────────────

const ctrlUserList = ref<api.ControllerUserList>({ defaultLevel: 1, list: [] })
const editingUserIdx = ref<number | null>(null)
const editUserForm = reactive<api.ControllerUserItem>({ level: 1, name: '', password: '', enablePassword: false })
const addingUser = ref(false)
const addUserForm = reactive<api.ControllerUserItem>({ level: 2, name: '', password: '', enablePassword: false })
const permConfigs = ref<api.PermissionConfig[]>([])
const permKeys = computed(() => {
  if (permConfigs.value.length === 0) return []
  return Object.keys(permConfigs.value[0].config)
})
const permKeyLabels: Record<string, string> = {
  baseFunc: '基本操作', remoteMode: '远程模式', systemTime: '系统时间', coordinate: '坐标系',
  loadParameters: '负载参数', buttonSettings: '按键设置', motionParameters: '运动参数',
  postureSettings: '姿态设置', trajectoryPlayback: '轨迹复现', communication: '通讯设置',
  installation: '安装设置', drag: '拖拽设置', security: '安全设置', autoManualSettings: '手自动模式',
  homeCalibration: '零点标定', advancedSettings: '高级功能', log: '日志',
  pluginOperations: '插件操作', projectStateOpertions: '工程运行', projectFileOperations: '工程编辑',
  teachPointOperations: '示教点位', IO: 'IO', Modbus: 'Modbus', Bus: 'Bus',
  globalVariable: '全局变量', jog: '点动', powerSettings: '电源设置', backgroundScriptConfig: '后台进程',
}
function levelName(l: number): string { return l === 0 ? '默认' : l === 1 ? '管理员' : l === 2 ? '技术员' : l === 3 ? '操作员' : `等级${l}` }
function isFixedLevel(l: number): boolean { return l >= 0 && l <= 3 }
function userDisplayName(l: number): string {
  if (isFixedLevel(l)) return levelName(l)
  const u = ctrlUserList.value.list.find(u => u.level === l)
  return u?.name || levelName(l)
}

async function loadUsers() {
  const res = await api.getControllerUsers(deviceId)
  if (res.success && res.data) ctrlUserList.value = res.data
  const pres = await api.getUserPermissions(deviceId)
  if (pres.success && pres.data) permConfigs.value = pres.data
}

function startEditUser(i: number) {
  editingUserIdx.value = i
  Object.assign(editUserForm, ctrlUserList.value.list[i])
}
function startAddUser() {
  const maxLevel = ctrlUserList.value.list.reduce((m, u) => Math.max(m, u.level), 3)
  addingUser.value = true
  Object.assign(addUserForm, { level: maxLevel + 1, name: '', password: '', enablePassword: false })
}
async function confirmAddUser() {
  const nameErr = validateAlias(addUserForm.name)
  if (nameErr) { toastRef.value?.error(nameErr); return }
  if (addUserForm.enablePassword) {
    const pwdErr = validateUserPassword(addUserForm.password, true)
    if (pwdErr) { toastRef.value?.error(pwdErr); return }
  }
  ctrlUserList.value.list.push({ ...addUserForm })
  addingUser.value = false
  await saveUserList()
}
async function saveEditUser(i: number) {
  const nameErr = validateAlias(editUserForm.name)
  if (nameErr) { toastRef.value?.error(nameErr); return }
  if (editUserForm.enablePassword) {
    const pwdErr = validateUserPassword(editUserForm.password, true)
    if (pwdErr) { toastRef.value?.error(pwdErr); return }
  }
  ctrlUserList.value.list[i] = { ...editUserForm }
  editingUserIdx.value = null
  await saveUserList()
}
function deleteUser(i: number) {
  const u = ctrlUserList.value.list[i]
  confirmAction(`删除用户「${isFixedLevel(u.level) ? levelName(u.level) : u.name}」？`, async () => {
    ctrlUserList.value.list.splice(i, 1)
    await saveUserList()
  })
}
async function saveUserList() {
  const res = await api.setControllerUsers(deviceId, ctrlUserList.value)
  if (res.success) toastRef.value?.success('用户列表已保存')
  else toastRef.value?.error(`保存用户失败：${res.error?.message}`)
}
function togglePerm(level: number, key: string, checked: boolean) {
  const pc = permConfigs.value.find(p => p.level === level)
  if (pc) pc.config[key] = checked ? 1 : 0
}
async function savePermissions() {
  const res = await api.setUserPermissions(deviceId, permConfigs.value)
  if (res.success) toastRef.value?.success('权限已保存')
  else toastRef.value?.error(`保存权限失败：${res.error?.message}`)
}

// ─── Coordinate Management ─────────────────────

const toolCoords = ref<api.CoordItem[]>([])
const userCoords = ref<api.CoordItem[]>([])
const editingCoordIdx = ref(-1)
const editingCoordType = ref('')
const editCoordForm = reactive<api.CoordItem>({ id: '', alias: '', enable: true, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 })
const addingCoord = ref(false)
const addCoordType = ref('')
const addCoordForm = reactive<api.CoordItem>({ id: '', alias: '', enable: true, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 })

async function loadCoords() {
  const [toolR, userR] = await Promise.all([api.getToolCoordinate(deviceId), api.getUserCoordinate(deviceId)])
  if (toolR.success && toolR.data) toolCoords.value = toolR.data.coordList
  if (userR.success && userR.data) userCoords.value = userR.data.coordList
}
/** 新增坐标系：id 取当前列表长度（对齐 OpenDobot46：name = id = 索引） */
function nextCoordId(list: api.CoordItem[]): string {
  const used = new Set(list.map(c => String(c.id)).filter(Boolean))
  let n = 0
  while (used.has(String(n))) n++
  return String(n)
}
function startAddCoord(type: string) {
  addingCoord.value = true
  addCoordType.value = type
  const list = type === 'tool' ? toolCoords.value : userCoords.value
  Object.assign(addCoordForm, { id: nextCoordId(list), alias: '', enable: true, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 })
}
async function confirmAddCoord() {
  const nameErr = validateAlias(addCoordForm.alias)
  if (nameErr) { toastRef.value?.error(nameErr); return }
  const item: api.CoordItem = { ...addCoordForm, alias: addCoordForm.alias.trim() }
  if (addCoordType.value === 'tool') toolCoords.value.push(item)
  else userCoords.value.push(item)
  addingCoord.value = false
  await saveCoords(addCoordType.value)
}
function startEditCoord(type: string, idx: number) {
  editingCoordIdx.value = idx; editingCoordType.value = type
  const src = type === 'tool' ? toolCoords.value[idx] : userCoords.value[idx]
  Object.assign(editCoordForm, {
    id: String(src.id ?? idx),
    alias: src.alias ?? '',
    enable: Boolean(src.enable),
    x: Number(src.x ?? 0),
    y: Number(src.y ?? 0),
    z: Number(src.z ?? 0),
    rx: Number(src.rx ?? 0),
    ry: Number(src.ry ?? 0),
    rz: Number(src.rz ?? 0),
    raw: src.raw,
  })
}
async function saveEditCoord() {
  const nameErr = validateAlias(editCoordForm.alias)
  if (nameErr) { toastRef.value?.error(nameErr); return }
  const item: api.CoordItem = { ...editCoordForm, alias: editCoordForm.alias.trim() }
  if (editingCoordType.value === 'tool') {
    toolCoords.value[editingCoordIdx.value] = item
  } else {
    userCoords.value[editingCoordIdx.value] = item
  }
  editingCoordIdx.value = -1
  await saveCoords(editingCoordType.value)
}
function deleteCoord(type: string, idx: number) {
  const list = type === 'tool' ? toolCoords.value : userCoords.value
  const name = list[idx]?.alias || '(未命名)'
  confirmAction(`删除${type === 'tool' ? '工具' : '用户'}坐标系「${name}」？`, async () => {
    if (type === 'tool') toolCoords.value.splice(idx, 1)
    else userCoords.value.splice(idx, 1)
    await saveCoords(type)
  })
}
async function saveCoords(type: string) {
  const data = { coordList: type === 'tool' ? toolCoords.value : userCoords.value }
  const fn = type === 'tool' ? api.setToolCoordinate : api.setUserCoordinate
  const res = await fn(deviceId, data)
  if (res.success) toastRef.value?.success(`${type === 'tool' ? '工具' : '用户'}坐标系已保存`)
  else toastRef.value?.error(`保存${type === 'tool' ? '工具' : '用户'}坐标系失败：${res.error?.message}`)
}

// ─── Custom Postures ────────────────────────────

const EMPTY_POSE: api.CustomPosturePose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }

function emptyPose(): api.CustomPosturePose {
  return { ...EMPTY_POSE }
}

function normalizePostureItem(p: api.CustomPostureItem, index = 0): api.CustomPostureItem {
  const type: api.CustomPostureType = p.type === 'cartesian' ? 'cartesian' : 'joint'
  const axisN = jointCount.value
  const joint = (p.joint || []).slice(0, axisN).map(j => Number(j) || 0)
  while (joint.length < axisN) joint.push(0)
  const item: api.CustomPostureItem = {
    name: String(p.name || '').trim() || `P${index + 1}`,
    type,
    joint,
  }
  if (type === 'cartesian') {
    const src = p.pose || EMPTY_POSE
    item.pose = {
      x: Number(src.x) || 0,
      y: Number(src.y) || 0,
      z: Number(src.z) || 0,
      rx: Number(src.rx) || 0,
      ry: Number(src.ry) || 0,
      rz: Number(src.rz) || 0,
    }
  }
  return item
}

const customPostures = ref<api.CustomPostureItem[]>([])

// System postures (always present, not stored on controller)
const systemPostures = computed<Array<{ name: string; type: 'joint'; joint: number[]; system: true }>>(() => {
  if (isMagician.value) {
    // Magician 四轴：无系统预设
    return []
  }
  return [
    { name: '零点', type: 'joint', joint: [0, 0, 0, 0, 0, 0], system: true },
    { name: '打包', type: 'joint', joint: [-90, 0, -140, -40, 0, 0], system: true },
    { name: '研究', type: 'joint', joint: [-90, 0, -90, 0, 90, 0], system: true },
  ]
})

interface PostureItem {
  _key: string
  name: string
  type: api.CustomPostureType
  joint: number[]
  pose?: api.CustomPosturePose
  system: boolean
  _controllerIdx?: number
}

const allPostures = computed<PostureItem[]>(() => [
  ...systemPostures.value.map((s, i) => ({
    ...s,
    _key: `sys-${i}`,
    joint: [...s.joint],
    type: 'joint' as const,
  })),
  ...customPostures.value.map((p, i) => {
    const n = normalizePostureItem(p, i)
    return {
      _key: `ctrl-${i}`,
      name: n.name,
      type: n.type ?? 'joint',
      joint: [...(n.joint || [])],
      pose: n.pose ? { ...n.pose } : undefined,
      system: false,
      _controllerIdx: i,
    }
  }),
])

const postureListExpanded = ref(false)
const editingPostureIdx = ref<number | null>(null)
const editPostureForm = reactive<api.CustomPostureItem>({
  name: '',
  type: 'joint',
  joint: [0, 0, 0, 0, 0, 0],
  pose: emptyPose(),
})

function formatPostureSummary(p: { type?: api.CustomPostureType; joint?: number[]; pose?: api.CustomPosturePose }): string {
  if (p.type === 'cartesian' && p.pose) {
    const { x, y, z, rx, ry, rz } = p.pose
    if (isMagician.value) {
      return `X${x.toFixed(1)} Y${y.toFixed(1)} Z${z.toFixed(1)}  R${rx.toFixed(1)}`
    }
    return `X${x.toFixed(1)} Y${y.toFixed(1)} Z${z.toFixed(1)}  RX${rx.toFixed(1)} RY${ry.toFixed(1)} RZ${rz.toFixed(1)}`
  }
  const j = p.joint || []
  return j.map(v => `${Number(v).toFixed(1)}°`).join(', ')
}

function formatPostureDetail(p: { type?: api.CustomPostureType; joint?: number[]; pose?: api.CustomPosturePose; name?: string }): string {
  if (p.type === 'cartesian' && p.pose) {
    const { x, y, z, rx, ry, rz } = p.pose
    if (isMagician.value) {
      return `${p.name || ''}  XYZ[${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}] R[${rx.toFixed(1)}]`
    }
    return `${p.name || ''}  XYZ[${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}] RXYZ[${rx.toFixed(1)}, ${ry.toFixed(1)}, ${rz.toFixed(1)}]`
  }
  return `${p.name || ''}  J[${(p.joint || []).map(v => Number(v).toFixed(1)).join(', ')}]`
}

async function loadPostures() {
  if (isMock) {
    try {
      const raw = localStorage.getItem(MOCK_PRESET_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as api.CustomPostureItem[]
        customPostures.value = (Array.isArray(parsed) ? parsed : []).map((p, i) => normalizePostureItem(p, i))
      } else {
        // 默认塞入标定参考点，方便开箱演示
        customPostures.value = [
          normalizePostureItem({
            name: '标定点1',
            type: 'joint',
            joint: [...REF_JOINT],
          }, 0),
          normalizePostureItem({
            name: '标定点1-位姿',
            type: 'cartesian',
            joint: [...REF_JOINT],
            pose: {
              x: REF_POSE[0], y: REF_POSE[1], z: REF_POSE[2],
              rx: REF_POSE[3], ry: REF_POSE[4], rz: REF_POSE[5],
            },
          }, 1),
          normalizePostureItem({
            name: '标定点2-位姿',
            type: 'cartesian',
            joint: [-76.022, 12.2459, -118.3444, 16.0986, 90, 193.978],
            pose: { x: -27.047, y: -227.9198, z: 236.033, rx: 180, ry: 0, rz: 0 },
          }, 2),
        ]
        localStorage.setItem(MOCK_PRESET_KEY, JSON.stringify(customPostures.value))
      }
    } catch (err) {
      console.warn('[Mock] loadPostures failed:', err)
      customPostures.value = []
    }
    // 初始化 moveTarget / targetPose（关节 + 笛卡尔）
    if (!moveTargetInit.value && fillMoveTargetsFromState()) {
      moveTargetInit.value = true
    }
    return
  }
  const res = await api.getCustomPostures(deviceId)
  if (res.success && res.data) {
    customPostures.value = res.data.map((p, i) => normalizePostureItem(p, i))
  }
}
function nextAutoName(): string {
  const maxN = customPostures.value.reduce((m, p) => {
    const match = /^P(\d+)$/.exec(p.name)
    return match ? Math.max(m, parseInt(match[1], 10)) : m
  }, 0)
  return `P${maxN + 1}`
}
function addEmptyPosture(type: api.CustomPostureType = 'joint') {
  customPostures.value.push(normalizePostureItem({
    name: nextAutoName(),
    type,
    joint: [0, 0, 0, 0, 0, 0],
    pose: emptyPose(),
  }))
  const idx = customPostures.value.length - 1
  startEditPosture(idx)
  postureListExpanded.value = true
  void savePostures()
}
// ─── Posture Drag Reorder ─────────────────────────

const dragPostureIdx = ref(-1)
const dragPostureOver = ref(-1)

function onPostureDragStart(e: DragEvent, idx: number) {
  const p = allPostures.value[idx]
  if (!p || p.system) { e.preventDefault(); return }
  dragPostureIdx.value = idx
  e.dataTransfer!.effectAllowed = 'move'
}
function onPostureDragOver(idx: number) {
  const p = allPostures.value[idx]
  if (!p || p.system || dragPostureIdx.value < 0) return
  if (dragPostureIdx.value !== idx) dragPostureOver.value = idx
}
function onPostureDragLeave() { dragPostureOver.value = -1 }
async function onPostureDrop(targetIdx: number) {
  const srcIdx = dragPostureIdx.value
  dragPostureIdx.value = -1; dragPostureOver.value = -1
  if (srcIdx < 0 || srcIdx === targetIdx) return
  const srcP = allPostures.value[srcIdx]
  const tgtP = allPostures.value[targetIdx]
  if (!srcP || srcP.system || !tgtP) return
  // Find the controller indices
  const srcCtrl = srcP._controllerIdx
  const tgtCtrl = tgtP._controllerIdx ?? customPostures.value.length
  if (srcCtrl === undefined) return
  const [moved] = customPostures.value.splice(srcCtrl, 1)
  const newIdx = tgtCtrl > srcCtrl ? tgtCtrl - 1 : tgtCtrl
  customPostures.value.splice(newIdx, 0, moved)
  await savePostures()
  toastRef.value?.success('预设已重新排序')
}
function onPostureDragEnd() { dragPostureIdx.value = -1; dragPostureOver.value = -1 }

async function addPostureFromCurrent(type: api.CustomPostureType = 'joint') {
  const name = nextAutoName()
  if (type === 'cartesian') {
    const pt = getCurrentCartesian()
    if (!pt) {
      toastRef.value?.error('无法读取当前笛卡尔位姿')
      return
    }
    customPostures.value.push(normalizePostureItem({
      name,
      type: 'cartesian',
      joint: getMoveTargetJoints(),
      pose: { x: pt.x, y: pt.y, z: pt.z, rx: pt.rx, ry: pt.ry, rz: pt.rz },
    }))
    postureListExpanded.value = true
    await savePostures(`位姿预设 "${name}" 已保存`)
    return
  }

  const joints = state.value.joints as Record<string, number> | undefined
  if (!joints) return
  customPostures.value.push(normalizePostureItem({
    name,
    type: 'joint',
    joint: [1, 2, 3, 4, 5, 6].map(j => Math.round((joints['j' + j] ?? 0) * 10) / 10),
  }))
  postureListExpanded.value = true
  await savePostures(`关节角预设 "${name}" 已保存`)
}
function startEditPosture(i: number) {
  editingPostureIdx.value = i
  const cur = normalizePostureItem(customPostures.value[i], i)
  editPostureForm.name = cur.name
  editPostureForm.type = cur.type ?? 'joint'
  editPostureForm.joint = [...(cur.joint || [0, 0, 0, 0, 0, 0])]
  editPostureForm.pose = cur.pose ? { ...cur.pose } : emptyPose()
}
async function saveEditPosture(i: number) {
  const nameErr = validateAlias(editPostureForm.name)
  if (nameErr) { toastRef.value?.error(nameErr); return }
  customPostures.value[i] = normalizePostureItem({
    name: String(editPostureForm.name || '').trim() || nextAutoName(),
    type: editPostureForm.type === 'cartesian' ? 'cartesian' : 'joint',
    joint: (editPostureForm.joint || []).map(Number),
    pose: editPostureForm.pose ? { ...editPostureForm.pose } : emptyPose(),
  }, i)
  editingPostureIdx.value = null
  await savePostures()
}
function deletePosture(i: number) {
  const name = customPostures.value[i]?.name || '(未命名)'
  confirmAction(`删除姿态预设「${name}」？`, async () => {
    customPostures.value.splice(i, 1)
    await savePostures()
  })
}
function deletePostureItem(ctrlIdx: number) { deletePosture(ctrlIdx) }
async function savePostures(successMessage?: string): Promise<boolean> {
  // 规范化后再提交，避免脏数据
  const payload = customPostures.value.map((p, i) => normalizePostureItem(p, i))
  customPostures.value = payload
  if (isMock) {
    try {
      localStorage.setItem(MOCK_PRESET_KEY, JSON.stringify(payload))
      toastRef.value?.success(successMessage || '预设已保存（dock 本地）')
      return true
    } catch (err) {
      toastRef.value?.error(`保存预设失败：${(err as Error).message}`)
      return false
    }
  }
  const res = await api.setCustomPostures(deviceId, payload)
  if (res.success) {
    toastRef.value?.success(successMessage || '预设已保存')
    return true
  }
  toastRef.value?.error(`保存预设失败：${res.error?.message}`)
  return false
}
const newPostureName = ref('')
const newPostureType = ref<api.CustomPostureType>('joint')

async function saveCurrentAsPosture() {
  if (!newPostureName.value.trim()) return
  const name = newPostureName.value.trim()
  const type = newPostureType.value
  let item: api.CustomPostureItem

  if (type === 'cartesian') {
    // 优先用位姿编辑框；若全为 0 则回退到当前实时位姿（Magician：R 存于 rx 槽位）
    const fromForm = isMagician.value
      ? {
          x: Number(targetPose.x || 0),
          y: Number(targetPose.y || 0),
          z: Number(targetPose.z || 0),
          rx: Number(targetPose.r || 0),
          ry: 0,
          rz: Number(targetPose.r || 0),
        }
      : {
          x: Number(targetPose.x || 0),
          y: Number(targetPose.y || 0),
          z: Number(targetPose.z || 0),
          rx: Number(targetPose.rx || 0),
          ry: Number(targetPose.ry || 0),
          rz: Number(targetPose.rz || 0),
        }
    const formIsZero = Object.values(fromForm).every(v => v === 0)
    const live = getCurrentCartesian()
    const pt = formIsZero && live ? live : fromForm
    item = normalizePostureItem({
      name,
      type: 'cartesian',
      joint: getMoveTargetJoints(),
      pose: { x: pt.x, y: pt.y, z: pt.z, rx: pt.rx, ry: pt.ry, rz: pt.rz },
    })
  } else {
    item = normalizePostureItem({
      name,
      type: 'joint',
      joint: getMoveTargetJoints(),
    })
  }

  const exists = customPostures.value.some(p => p.name === name)
  if (exists) {
    const idx = customPostures.value.findIndex(p => p.name === name)
    customPostures.value[idx] = item
  } else {
    customPostures.value.push(item)
  }
  newPostureName.value = ''
  postureListExpanded.value = true
  const kind = type === 'cartesian' ? '位姿' : '关节角'
  await savePostures(exists ? `${kind}预设 "${name}" 已更新` : `${kind}预设 "${name}" 已保存`)
}

// ─── Posture Rename ─────────────────────────────

const renamingPostureKey = ref('')
const renamePostureValue = ref('')
const renamePostureInputRef = ref<HTMLInputElement | null>(null)

function startRenamePosture(p: PostureItem) {
  renamingPostureKey.value = p._key
  renamePostureValue.value = p.name
}
function confirmRenamePosture(p: PostureItem) {
  if (!renamePostureValue.value.trim() || renamePostureValue.value === p.name) {
    renamingPostureKey.value = ''
    return
  }
  const nameErr = validateAlias(renamePostureValue.value)
  if (nameErr) { toastRef.value?.error(nameErr); return }
  if (p._controllerIdx !== undefined) {
    customPostures.value[p._controllerIdx] = {
      ...normalizePostureItem(customPostures.value[p._controllerIdx], p._controllerIdx),
      name: renamePostureValue.value.trim(),
    }
    savePostures()
  }
  renamingPostureKey.value = ''
  toastRef.value?.success(`已重命名为 "${renamePostureValue.value.trim()}"`)
}

/** 点击预设：关节填充 moveTarget；笛卡尔填充 targetPose。
 *  Dock 模式下用离线 FK/IK 交叉填充另一侧，方便直接点「移动」。
 */
function fillPosture(p: { type?: api.CustomPostureType; joint?: number[]; pose?: api.CustomPosturePose; name?: string }) {
  if (p.type === 'cartesian' && p.pose) {
    if (isMagician.value) {
      targetPose.x = p.pose.x
      targetPose.y = p.pose.y
      targetPose.z = p.pose.z
      targetPose.r = p.pose.rx
    } else {
      targetPose.x = p.pose.x
      targetPose.y = p.pose.y
      targetPose.z = p.pose.z
      targetPose.rx = p.pose.rx
      targetPose.ry = p.pose.ry
      targetPose.rz = p.pose.rz
    }
    if (isMock) {
      const near = jointsFromObject(state.value.joints as Record<string, number>)
      const ik = inverseKinematics(
        [p.pose.x, p.pose.y, p.pose.z, p.pose.rx, p.pose.ry, p.pose.rz],
        near,
      )
      if (ik.ok && ik.joint) setMoveTargetJoints(ik.joint)
    } else if (p.joint && p.joint.length >= jointCount.value) {
      setMoveTargetJoints(p.joint)
    }
    toastRef.value?.info(`已填充位姿预设${p.name ? ` "${p.name}"` : ''}`)
    return
  }
  const joint = p.joint || []
  for (let j = 1; j <= jointCount.value; j++) moveTarget['j' + j] = joint[j - 1] ?? 0
  if (isMock && joint.length >= 6) {
    try {
      const fk = forwardKinematics(joint)
      if (Number.isFinite(fk[0])) {
        targetPose.x = +fk[0].toFixed(4)
        targetPose.y = +fk[1].toFixed(4)
        targetPose.z = +fk[2].toFixed(4)
        if (Number.isFinite(fk[3])) {
          targetPose.rx = fk[3]
          targetPose.ry = fk[4]
          targetPose.rz = fk[5]
        }
      }
    } catch { /* ignore */ }
  }
  toastRef.value?.info(`已填充关节角预设${p.name ? ` "${p.name}"` : ''}`)
}

// ─── Motion Parameters ─────────────────────────

interface MotionRowModel {
  label: string
  velocity: number
  acceleration: number
  jerk: number
  suffixVel: string
  suffixAcc: string
  suffixJerk: string
}

interface MotionGroupModel {
  key: 'teach' | 'playback'
  label: string
  showJerk: boolean
  loading: boolean
  saving: boolean
  loaded: boolean
  loadError: string
  rows: MotionRowModel[]
  /** 坐标组的额外字段（如 playback coordinate 的 jerkMulti），写回时保留 */
  extra: Record<string, unknown>
}

const MOTION_LABELS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'X/Y/Z', 'RX/RY/RZ']

function makeMotionRows(): MotionRowModel[] {
  return MOTION_LABELS.map((label, i) => {
    const unit = i === 6 ? 'mm' : '°'
    return {
      label,
      velocity: 0,
      acceleration: 0,
      jerk: 0,
      suffixVel: `${unit}/s`,
      suffixAcc: `${unit}/s²`,
      suffixJerk: `${unit}/s³`,
    }
  })
}

const motionGroups = reactive<Record<'teach' | 'playback', MotionGroupModel>>({
  teach: {
    key: 'teach', label: '示教设置', showJerk: false,
    loading: false, saving: false, loaded: false, loadError: '', rows: makeMotionRows(), extra: {},
  },
  playback: {
    key: 'playback', label: '再现设置', showJerk: true,
    loading: false, saving: false, loaded: false, loadError: '', rows: makeMotionRows(), extra: {},
  },
})

const motionGroupsList = computed(() => [motionGroups.teach, motionGroups.playback])

function motionArrays(raw: Record<string, unknown>): { velocity: number[]; acceleration: number[]; jerk: number[] } {
  const toArr = (v: unknown) => (Array.isArray(v) ? v.map(n => Number(n) || 0) : [])
  return { velocity: toArr(raw.velocity), acceleration: toArr(raw.acceleration), jerk: toArr(raw.jerk) }
}

/** 读取一组运动参数（示教 / 再现），填充 8 行（J1..J6、X/Y/Z、RX/RY/RZ） */
async function loadMotionGroup(key: 'teach' | 'playback') {
  const grp = motionGroups[key]
  grp.loading = true
  grp.loadError = ''
  try {
    const [jointR, coordR] = key === 'teach'
      ? [await api.getTeachJointParams(deviceId), await api.getTeachCoordinateParams(deviceId)]
      : [await api.getPlaybackJointParams(deviceId), await api.getPlaybackCoordinateParams(deviceId)]
    if (!jointR.success || !jointR.data || !coordR.success || !coordR.data) {
      grp.loadError = jointR.error?.message || coordR.error?.message || '读取失败'
      grp.loaded = false
      return
    }
    const j = motionArrays(jointR.data as Record<string, unknown>)
    const c = motionArrays(coordR.data as Record<string, unknown>)
    const rows = grp.rows
    for (let i = 0; i < 6; i++) {
      rows[i].velocity = j.velocity[i] ?? 0
      rows[i].acceleration = j.acceleration[i] ?? 0
      rows[i].jerk = j.jerk[i] ?? 0
    }
    rows[6].velocity = c.velocity[0] ?? 0
    rows[6].acceleration = c.acceleration[0] ?? 0
    rows[6].jerk = c.jerk[0] ?? 0
    rows[7].velocity = c.velocity[1] ?? 0
    rows[7].acceleration = c.acceleration[1] ?? 0
    rows[7].jerk = c.jerk[1] ?? 0
    grp.extra = { ...(coordR.data as Record<string, unknown>) }
    grp.loaded = true
  } catch (err) {
    grp.loadError = (err as Error).message
    grp.loaded = false
  } finally {
    grp.loading = false
  }
}

/** 保存一组运动参数（joint + coordinate 两个接口） */
async function saveMotionGroup(key: 'teach' | 'playback') {
  const grp = motionGroups[key]
  if (!grp.loaded) return
  for (const row of grp.rows) {
    for (const f of ['velocity', 'acceleration', 'jerk'] as const) {
      const v = row[f]
      if (!Number.isFinite(v) || v < 0) {
        const label = f === 'velocity' ? '速度' : f === 'acceleration' ? '加速度' : '加加速度'
        toastRef.value?.error(`${row.label} 的${label}必须 ≥ 0`)
        return
      }
    }
  }
  const joint = {
    velocity: grp.rows.slice(0, 6).map(r => r.velocity),
    acceleration: grp.rows.slice(0, 6).map(r => r.acceleration),
    jerk: grp.rows.slice(0, 6).map(r => r.jerk),
  }
  const coordinate = {
    ...grp.extra,
    velocity: [grp.rows[6].velocity, grp.rows[7].velocity],
    acceleration: [grp.rows[6].acceleration, grp.rows[7].acceleration],
    jerk: [grp.rows[6].jerk, grp.rows[7].jerk],
  }
  grp.saving = true
  try {
    const [r1, r2] = key === 'teach'
      ? [await api.setTeachJointParams(deviceId, joint), await api.setTeachCoordinateParams(deviceId, coordinate)]
      : [await api.setPlaybackJointParams(deviceId, joint), await api.setPlaybackCoordinateParams(deviceId, coordinate)]
    if (!r1.success || !r2.success) {
      toastRef.value?.error(`保存失败：${r1.error?.message || r2.error?.message}`)
      return
    }
    toastRef.value?.success(`${grp.label}已保存`)
    await loadMotionGroup(key)
  } catch (err) {
    toastRef.value?.error(`保存出错：${(err as Error).message}`)
  } finally {
    grp.saving = false
  }
}

/** 恢复默认值：从 /properties/default 读取 def 并写回 */
async function resetMotionGroup(key: 'teach' | 'playback') {
  const grp = motionGroups[key]
  confirmAction(`将 ${grp.label}恢复为默认值？`, async () => {
    const res = await api.getMotionDefaults(deviceId)
    if (!res.success || !res.data) {
      toastRef.value?.error(`读取默认值失败：${res.error?.message}`)
      return
    }
    const section = (res.data[key] ?? {}) as Record<string, unknown>
    const joint = (section.joint ?? {}) as Record<string, unknown>
    const coord = (section.coordinate ?? {}) as Record<string, unknown>
    const defOf = (holder: Record<string, unknown>, field: string, i: number): number => {
      const list = Array.isArray(holder[field]) ? (holder[field] as Array<Record<string, unknown>>) : []
      return Number(list[i]?.def ?? 0)
    }
    const rows = grp.rows
    for (let i = 0; i < 6; i++) {
      rows[i].velocity = defOf(joint, 'velocity', i)
      rows[i].acceleration = defOf(joint, 'acceleration', i)
      rows[i].jerk = defOf(joint, 'jerk', i)
    }
    rows[6].velocity = defOf(coord, 'velocity', 0)
    rows[6].acceleration = defOf(coord, 'acceleration', 0)
    rows[6].jerk = defOf(coord, 'jerk', 0)
    rows[7].velocity = defOf(coord, 'velocity', 1)
    rows[7].acceleration = defOf(coord, 'acceleration', 1)
    rows[7].jerk = defOf(coord, 'jerk', 1)
    await saveMotionGroup(key)
  }, '恢复默认')
}

/** 切换「运动」tab 时自动读取全部两组参数 */
async function loadAllMotionParams() {
  await Promise.all([loadMotionGroup('teach'), loadMotionGroup('playback')])
}

// ─── Communication ─────────────────────────────

const busForm = reactive({ type: '', baudRate: 115200, slaveId: 1, dataBits: 8, stopBits: 1, parity: 'none' })
async function loadBus() {
  const res = await api.getBus(deviceId)
  if (res.success && res.data) {
    const d = res.data as Record<string, unknown>
    busForm.type = String(d.type ?? busForm.type)
    busForm.baudRate = Number(d.baudRate ?? busForm.baudRate) || 0
    busForm.slaveId = Number(d.slaveId ?? busForm.slaveId) || 0
    busForm.dataBits = Number(d.dataBits ?? busForm.dataBits) || 0
    busForm.stopBits = Number(d.stopBits ?? busForm.stopBits) || 0
    busForm.parity = String(d.parity ?? busForm.parity)
  } else if (res.error?.code !== 40401) {
    toastRef.value?.error(`读取总线失败：${res.error?.message}`)
  }
}
async function saveBus() {
  if (!Number.isFinite(busForm.baudRate) || busForm.baudRate < 1200 || busForm.baudRate > 4000000) {
    toastRef.value?.error('波特率范围 1200 ~ 4000000')
    return
  }
  if (!Number.isFinite(busForm.slaveId) || busForm.slaveId < 1 || busForm.slaveId > 247) {
    toastRef.value?.error('从站 ID 范围 1 ~ 247')
    return
  }
  const res = await api.setBus(deviceId, { ...busForm })
  if (res.success) {
    toastRef.value?.success('总线设置已保存')
    loadBus()
  } else {
    toastRef.value?.error(`总线保存失败：${res.error?.message}`)
  }
}

const wifiForm = reactive<Record<string, unknown>>({ ssid: '', passWd: '', enable: false })
async function loadWiFi() {
  const res = await api.getWiFi(deviceId)
  if (res.success && res.data) Object.assign(wifiForm, res.data)
}
async function saveWiFi() {
  const enabled = !!wifiForm.enable
  if (enabled) {
    const ssidErr = validateSsid(String(wifiForm.ssid ?? ''))
    if (ssidErr) { toastRef.value?.error(ssidErr); return }
    const pwdErr = validateWifiPassword(String(wifiForm.passWd ?? ''))
    if (pwdErr) { toastRef.value?.error(pwdErr); return }
  }
  const res = await api.setWiFi(deviceId, { ...wifiForm })
  if (res.success) {
    toastRef.value?.success('WiFi 设置已保存')
    loadWiFi()
  } else {
    toastRef.value?.error(`WiFi 保存失败：${res.error?.message}`)
  }
}

const ethForm = reactive({ dhcp: true, ip: '', mask: '', gateway: '' })
async function loadEthernet() {
  const res = await api.getEthernet(deviceId)
  if (res.success && res.data) {
    const d = res.data as Record<string, unknown>
    ethForm.dhcp = Boolean(d.dhcp)
    ethForm.ip = String(d.ip ?? '')
    ethForm.mask = String(d.mask ?? '')
    ethForm.gateway = String(d.gateway ?? '')
  }
}
async function saveEthernet() {
  if (!ethForm.dhcp) {
    const checks: Array<[string, string]> = [
      ['ip', 'IP'],
      ['mask', '子网掩码'],
      ['gateway', '网关'],
    ]
    for (const [key, label] of checks) {
      const err = validateIpv4(ethForm[key as 'ip'], label)
      if (err) { toastRef.value?.error(err); return }
    }
  }
  const res = await api.setEthernet(deviceId, { dhcp: ethForm.dhcp, ip: ethForm.ip, mask: ethForm.mask, gateway: ethForm.gateway })
  if (res.success) {
    toastRef.value?.success('以太网设置已保存')
    loadEthernet()
  } else {
    toastRef.value?.error(`以太网保存失败：${res.error?.message}`)
  }
}

// ─── 按键设置 ──────────────────────────────────

const buttonModeForm = reactive<{ mode: 'playback' | 'project'; projectName: string }>({ mode: 'playback', projectName: '' })
const buttonProjects = ref<string[]>([])
const loadingButtonProjects = ref(false)

async function loadButtonMode() {
  const res = await api.getButtonMode(deviceId)
  if (res.success && res.data) {
    const d = res.data as Record<string, unknown>
    buttonModeForm.mode = d.mode === 'project' ? 'project' : 'playback'
    buttonModeForm.projectName = String(d.projectName ?? '')
  } else if (res.error?.code !== 40401) {
    toastRef.value?.error(`读取按键模式失败：${res.error?.message}`)
  }
}
async function loadButtonProjects() {
  loadingButtonProjects.value = true
  try {
    const res = await api.listDeviceProjects(deviceId)
    if (res.success && res.data) {
      buttonProjects.value = res.data
        .map(p => typeof p === 'string' ? p : String((p as { name?: string }).name ?? ''))
        .filter(Boolean)
    }
  } catch { /* ignore */ }
  finally { loadingButtonProjects.value = false }
}
async function saveButtonMode() {
  const res = await api.setButtonMode(deviceId, { ...buttonModeForm })
  if (res.success) {
    toastRef.value?.success('按键模式已保存')
    loadButtonMode()
  } else {
    toastRef.value?.error(`保存按键模式失败：${res.error?.message}`)
  }
}

// ─── 电源设置（刹车电压）───────────────────────

const ccboxForm = reactive({ min: 0, max: 0 })

async function loadCCBoxVoltage() {
  const res = await api.getCCBoxVoltage(deviceId)
  if (res.success && res.data) {
    const d = res.data as Record<string, unknown>
    ccboxForm.min = Number(d.min ?? 0)
    ccboxForm.max = Number(d.max ?? 0)
  } else if (res.error?.code !== 40401) {
    toastRef.value?.error(`读取刹车电压失败：${res.error?.message}`)
  }
}
function validateCCBox(): string | null {
  const { min, max } = ccboxForm
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '电压必须为数字'
  if (min < 30 || min > 60 || max < 30 || max > 60) return '电压范围 30 ~ 60V'
  if (min > max) return '最低电压不能高于最高电压'
  return null
}
async function saveCCBoxVoltage() {
  const err = validateCCBox()
  if (err) { toastRef.value?.error(err); return }
  const res = await api.setCCBoxVoltage(deviceId, { ...ccboxForm })
  if (res.success) {
    toastRef.value?.success('刹车电压已保存')
    loadCCBoxVoltage()
  } else {
    toastRef.value?.error(`保存刹车电压失败：${res.error?.message}`)
  }
}
function resetCCBoxVoltage() {
  confirmAction('将刹车电压恢复为默认值（{0, 0}）？', async () => {
    const res = await api.setCCBoxVoltage(deviceId, { min: 0, max: 0 })
    if (res.success) {
      toastRef.value?.success('刹车电压已恢复默认')
      loadCCBoxVoltage()
    } else {
      toastRef.value?.error(`恢复失败：${res.error?.message}`)
    }
  }, '恢复默认')
}

// ─── 拖动设置 ──────────────────────────────────

const dragForm = reactive<Record<string, number>>({ j1: 50, j2: 50, j3: 50, j4: 50, j5: 50, j6: 50 })

async function loadDragSensivity() {
  const res = await api.getDragSensivity(deviceId)
  if (res.success && res.data) {
    const d = res.data as Record<string, unknown>
    for (let j = 1; j <= 6; j++) {
      const v = Number(d['j' + j])
      if (Number.isFinite(v)) dragForm['j' + j] = v
    }
  } else if (res.error?.code !== 40401) {
    toastRef.value?.error(`读取拖动灵敏度失败：${res.error?.message}`)
  }
}
async function saveDragSensivity() {
  const payload: Record<string, number> = { ...dragForm }
  for (const v of Object.values(payload)) {
    if (!Number.isFinite(v) || v < 30 || v > 70) {
      toastRef.value?.error('灵敏度范围 30 ~ 70')
      return
    }
  }
  const res = await api.setDragSensivity(deviceId, payload)
  if (res.success) {
    toastRef.value?.success('拖动灵敏度已保存')
    loadDragSensivity()
  } else {
    toastRef.value?.error(`保存拖动灵敏度失败：${res.error?.message}`)
  }
}

// ─── 远程控制（IO / Modbus）────────────────────

const remoteTab = ref<'io' | 'modbus'>('io')
const ioCtrlRaw = ref<Record<string, unknown> | null>(null)
const modbusRaw = ref<Record<string, unknown> | null>(null)

interface RemoteProjectRow { name: string; value: number }

const ioCtrlForm = reactive<{ triggerMode: number; optionProject: { type: number; defaultProject: string } }>({
  triggerMode: 1, optionProject: { type: 0, defaultProject: '' },
})
/** DI 组数值（DI 地址，最多 4 组） */
const ioDiGroup = ref<number[]>([])
/** 组 IO → 工程映射（2^len 项：value = 组IO数值） */
const ioDiProjects = ref<RemoteProjectRow[]>([])

async function loadRemoteIO() {
  const res = await api.getRemoteIOCtrl(deviceId)
  if (!res.success || !res.data) {
    toastRef.value?.error(`读取远程 IO 失败：${res.error?.message}`)
    return
  }
  const raw = res.data as Record<string, unknown>
  ioCtrlRaw.value = raw
  const opt = (raw.optionProject ?? {}) as Record<string, unknown>
  ioCtrlForm.triggerMode = Number(raw.triggerMode ?? 1) || 1
  ioCtrlForm.optionProject.type = Number(opt.type ?? 0)
  ioCtrlForm.optionProject.defaultProject = String(opt.defaultProject ?? '')
  ioDiGroup.value = (Array.isArray(opt.diGroup) ? opt.diGroup : []).map(n => Number(n) || 0)
  ioDiProjects.value = (Array.isArray(opt.projectList) ? opt.projectList : [])
    .map(r => ({ name: String((r as RemoteProjectRow).name ?? ''), value: Number((r as RemoteProjectRow).value ?? 0) }))
    .sort((a, b) => a.value - b.value)
  syncIoDiProjects()
}
/** 组数变化时重建工程映射表：2^len 项，保留同名数值的已有选择 */
function syncIoDiProjects() {
  const count = Math.pow(2, ioDiGroup.value.length)
  const prev = ioDiProjects.value
  ioDiProjects.value = new Array(count).fill(0).map((_, idx) => {
    const found = prev.find(p => p.value === idx)
    return { name: found ? found.name : '', value: idx }
  })
}
function ioDiAddGroup() {
  if (ioDiGroup.value.length >= 4) return
  ioDiGroup.value.push(ioDiGroup.value.length)
  syncIoDiProjects()
}
function ioDiRemoveGroup() {
  if (ioDiGroup.value.length === 0) return
  ioDiGroup.value.pop()
  syncIoDiProjects()
}
async function saveRemoteIO() {
  if (!ioCtrlRaw.value) return
  const payload = JSON.parse(JSON.stringify(ioCtrlRaw.value)) as Record<string, unknown>
  const opt = (payload.optionProject ?? {}) as Record<string, unknown>
  opt.type = ioCtrlForm.optionProject.type
  opt.defaultProject = ioCtrlForm.optionProject.defaultProject
  opt.diGroup = [...ioDiGroup.value]
  opt.projectList = ioDiProjects.value.map(p => ({ ...p }))
  payload.optionProject = opt
  payload.triggerMode = ioCtrlForm.triggerMode
  const res = await api.setRemoteIOCtrl(deviceId, payload)
  if (res.success) {
    toastRef.value?.success('IO 远程控制已保存')
    loadRemoteIO()
  } else {
    toastRef.value?.error(`保存 IO 远程控制失败：${res.error?.message}`)
  }
}

const modbusForm = reactive<{ triggerMode: number; holdType: number; holdDefaultProject: string }>({
  triggerMode: 1, holdType: 0, holdDefaultProject: '',
})
/** 保持寄存器数值（寄存器数值字段） */
const modbusHoldOption = ref(0)
/** 备选工程映射表（寄存器数值 → 工程名） */
const modbusHoldProjects = ref<RemoteProjectRow[]>([])

async function loadRemoteModbus() {
  const res = await api.getRemoteModbus(deviceId)
  if (!res.success || !res.data) {
    toastRef.value?.error(`读取远程 Modbus 失败：${res.error?.message}`)
    return
  }
  const raw = res.data as Record<string, unknown>
  modbusRaw.value = raw
  const hold = (raw.hold ?? {}) as Record<string, unknown>
  modbusForm.triggerMode = Number(raw.triggerMode ?? 1) || 1
  modbusForm.holdType = Number(hold.type ?? 0)
  modbusForm.holdDefaultProject = String(hold.defaultProject ?? '')
  modbusHoldOption.value = Number(hold.optionProject ?? 0)
  modbusHoldProjects.value = (Array.isArray(hold.projectList) ? hold.projectList : [])
    .map(r => ({ name: String((r as RemoteProjectRow).name ?? ''), value: Number((r as RemoteProjectRow).value ?? 0) }))
    .sort((a, b) => a.value - b.value)
}
function modbusHoldAddProject() {
  if (modbusHoldProjects.value.length >= 256) return
  modbusHoldProjects.value.push({ name: '', value: modbusHoldProjects.value.length })
}
function modbusHoldRemoveProject() {
  if (modbusHoldProjects.value.length === 0) return
  modbusHoldProjects.value.pop()
}
async function saveRemoteModbus() {
  if (!modbusRaw.value) return
  const payload = JSON.parse(JSON.stringify(modbusRaw.value)) as Record<string, unknown>
  const hold = (payload.hold ?? {}) as Record<string, unknown>
  hold.type = modbusForm.holdType
  hold.defaultProject = modbusForm.holdDefaultProject
  hold.optionProject = modbusHoldOption.value
  hold.projectList = modbusHoldProjects.value.map(p => ({ ...p }))
  payload.hold = hold
  payload.triggerMode = modbusForm.triggerMode
  const res = await api.setRemoteModbus(deviceId, payload)
  if (res.success) {
    toastRef.value?.success('Modbus 远程控制已保存')
    loadRemoteModbus()
  } else {
    toastRef.value?.error(`保存 Modbus 远程控制失败：${res.error?.message}`)
  }
}

// ─── Dobot+ ─────────────────────────────────────

const dobotPlusList = ref<string[]>([])
const dobotPlusPorts = ref<Record<string, string>>({})
const dobotPlusInstallName = ref('')
const dobotPlusCatalog = ref<api.DobotPlusCatalog>({ available: [], present: [], metadata: {} })
const dobotPlusLocal = ref<api.DobotPlusPluginMeta[]>([])
const loadingDobotPlus = ref(false)
const loadingDobotPlusCatalog = ref(false)
const loadingDobotPlusLocal = ref(false)
const installingDobotPlus = ref(false)
const installingName = ref('')
const dobotPlusUploadFile = ref<File | null>(null)
const uploadingDobotPlus = ref(false)
const activeDobotPlus = ref('')
const activeDobotPlusIframe = ref('')
const activeDobotPlusIframeName = ref('')
const dobotPlusIframeRef = ref<HTMLIFrameElement | null>(null)
const dobotPlusCallFn = ref('')
const dobotPlusCallArgs = ref('')
const dobotPlusCalling = ref(false)
const dobotPlusCallResult = ref<string | null>(null)
const dobotPlusCallError = ref('')

interface InstallablePlugin {
  name: string
  local: boolean
  controller: boolean
  description?: string
}

/** 可安装列表 = 控制器目录（eco_config + ecology 目录）+ 本地放置资源中尚未安装的插件 */
const installableDobotPlus = computed<InstallablePlugin[]>(() => {
  const installed = new Set(dobotPlusList.value)
  const map = new Map<string, InstallablePlugin>()
  const add = (name: string, source: 'local' | 'controller', description?: string) => {
    if (installed.has(name)) return
    const key = name.toLowerCase()
    const existing = map.get(key)
    if (existing) {
      if (source === 'local') existing.local = true
      else existing.controller = true
      if (description && !existing.description) existing.description = description
      return
    }
    map.set(key, { name, local: source === 'local', controller: source === 'controller', description })
  }
  for (const n of [...dobotPlusCatalog.value.available, ...dobotPlusCatalog.value.present]) {
    const metaKey = Object.keys(dobotPlusCatalog.value.metadata).find(k => k.toLowerCase() === n.toLowerCase())
    add(n, 'controller', metaKey ? dobotPlusCatalog.value.metadata[metaKey]?.description : undefined)
  }
  for (const p of dobotPlusLocal.value) {
    add(p.name, 'local', p.description)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
})

/** 插件描述：本地资源优先，其次控制器 metadata，都没有则返回空 */
function dobotPlusDescription(name: string): string {
  const lower = name.toLowerCase()
  const local = dobotPlusLocal.value.find(p => p.name.toLowerCase() === lower)
  if (local?.description) return local.description
  const key = Object.keys(dobotPlusCatalog.value.metadata).find(k => k.toLowerCase() === lower)
  if (key) return dobotPlusCatalog.value.metadata[key]?.description ?? ''
  return ''
}

function dobotPlusTooltip(name: string): string {
  const port = dobotPlusPorts.value[name] || '?'
  const desc = dobotPlusDescription(name)
  return desc ? `端口 ${port} · ${desc}` : `端口 ${port}`
}

// DobotES01 吸盘
const hasDobotES01 = computed(() => dobotPlusList.value.some(n => /^DobotES01/i.test(n)))
const es01Busy = ref(false)
const es01StatusCode = ref<number | null>(null) // 0=吸附 1=释放 2=异常
const es01StatusKey = computed(() => {
  if (es01StatusCode.value === 0) return 'grip'
  if (es01StatusCode.value === 2) return 'alarm'
  if (es01StatusCode.value === 1) return 'release'
  return 'unknown'
})
const es01StatusText = computed(() => {
  if (es01StatusCode.value === 0) return '吸附中'
  if (es01StatusCode.value === 1) return '已释放'
  if (es01StatusCode.value === 2) return '异常'
  return '—'
})
let es01StatusTimer: ReturnType<typeof setInterval> | null = null

async function loadDobotPlusList() {
  loadingDobotPlus.value = true
  try {
    const [listRes, portsRes] = await Promise.all([
      api.listDobotPlus(deviceId),
      api.getDobotPlusPorts(deviceId),
    ])
    if (listRes.success && listRes.data) dobotPlusList.value = listRes.data
    if (portsRes.success && portsRes.data) {
      const p: Record<string, string> = {}
      for (const [k, v] of Object.entries(portsRes.data)) p[k] = String(v)
      dobotPlusPorts.value = p
    }
    // 有 ES01 时启动状态轮询
    if (hasDobotES01.value) {
      void refreshES01Status()
      startES01StatusPoll()
    } else {
      stopES01StatusPoll()
    }
  } catch (err) { console.warn('[DobotPlus] load failed:', err) }
  finally { loadingDobotPlus.value = false }
}

async function refreshES01Status() {
  if (!isConnected.value || !hasDobotES01.value) return
  try {
    const res = await api.getDobotES01Status(deviceId)
    if (res.success && res.data && typeof (res.data as api.DobotES01Status).status === 'number') {
      es01StatusCode.value = (res.data as api.DobotES01Status).status
    }
  } catch { /* ignore */ }
}

function startES01StatusPoll() {
  if (es01StatusTimer) return
  es01StatusTimer = setInterval(() => { void refreshES01Status() }, 1500)
}

function stopES01StatusPoll() {
  if (es01StatusTimer) {
    clearInterval(es01StatusTimer)
    es01StatusTimer = null
  }
}

async function doES01(action: 'grip' | 'release' | 'clearAlarm') {
  if (!isConnected.value) { toastRef.value?.error('设备未连接'); return }
  if (es01Busy.value) return
  es01Busy.value = true
  try {
    const res = await api.controlDobotES01(deviceId, action)
    if (res.success) {
      const labels = { grip: '吸取', release: '释放', clearAlarm: '清错' } as const
      toastRef.value?.success(`吸盘${labels[action]}成功`)
      // 立即刷新状态
      if (action === 'grip') es01StatusCode.value = 0
      else if (action === 'release') es01StatusCode.value = 1
      setTimeout(() => { void refreshES01Status() }, 300)
    } else {
      toastRef.value?.error(`吸盘操作失败：${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`吸盘操作出错：${(err as Error).message}`)
  } finally {
    es01Busy.value = false
  }
}

// ─── Magician 末端执行器：吸盘 / 夹爪（状态本地缓存，协议无状态查询）───

const magicianSuction = ref(false)
const magicianGripper = ref(false)

/** Magician 末端快捷键：Z/X 吸盘吸取/释放，V/B 夹爪抓紧/松开 */
const MAGICIAN_EE_KEY_MAP: Record<string, { kind: 'suction' | 'gripper'; on: boolean }> = {
  z: { kind: 'suction', on: true },
  x: { kind: 'suction', on: false },
  v: { kind: 'gripper', on: true },
  b: { kind: 'gripper', on: false },
}

async function setMagicianSuction(on: boolean) {
  if (!isConnected.value) { toastRef.value?.error('设备未连接'); return }
  magicianSuction.value = on
  await api.setEndEffector(deviceId, 'suction', on).then((res) => {
    if (res.success) toastRef.value?.success(`吸盘${on ? '吸取' : '释放'}成功`)
    else {
      magicianSuction.value = !on
      toastRef.value?.error(`吸盘操作失败：${res.error?.message}`)
    }
  }).catch((err) => {
    magicianSuction.value = !on
    toastRef.value?.error(`吸盘操作出错：${(err as Error).message}`)
  })
}

async function setMagicianGripper(on: boolean) {
  if (!isConnected.value) { toastRef.value?.error('设备未连接'); return }
  magicianGripper.value = on
  await api.setEndEffector(deviceId, 'gripper', on).then((res) => {
    if (res.success) toastRef.value?.success(`夹爪${on ? '抓紧' : '松开'}成功`)
    else {
      magicianGripper.value = !on
      toastRef.value?.error(`夹爪操作失败：${res.error?.message}`)
    }
  }).catch((err) => {
    magicianGripper.value = !on
    toastRef.value?.error(`夹爪操作出错：${(err as Error).message}`)
  })
}

function handleMagicianEEKey(key: string): boolean {
  if (!isMagician.value || !isConnected.value) return false
  const map = MAGICIAN_EE_KEY_MAP[key]
  if (!map) return false
  if (map.kind === 'suction') void setMagicianSuction(map.on)
  else void setMagicianGripper(map.on)
  return true
}
async function loadDobotPlusCatalog() {
  loadingDobotPlusCatalog.value = true
  try {
    const res = await api.getDobotPlusCatalog(deviceId)
    if (res.success && res.data) dobotPlusCatalog.value = res.data
  } catch (err) { console.warn('[DobotPlus] catalog load failed:', err) }
  finally { loadingDobotPlusCatalog.value = false }
}

async function loadDobotPlusLocal() {
  loadingDobotPlusLocal.value = true
  try {
    const res = await api.getDobotPlusLocal()
    if (res.success && res.data) dobotPlusLocal.value = res.data.plugins
  } catch (err) { console.warn('[DobotPlus] local load failed:', err) }
  finally { loadingDobotPlusLocal.value = false }
}

function refreshDobotPlusSources() {
  loadDobotPlusCatalog()
  loadDobotPlusLocal()
}

async function installDobotPlusPlugin(name?: string) {
  const target = (name ?? dobotPlusInstallName.value).trim()
  if (!target || installingDobotPlus.value) return
  const item = installableDobotPlus.value.find(p => p.name === target)
  const useLocal = Boolean(item?.local) && !item?.controller
  installingName.value = target
  installingDobotPlus.value = true
  try {
    const res = useLocal
      ? await api.installLocalDobotPlusPlugin(deviceId, target)
      : await api.manageDobotPlus(deviceId, target, 'install')
    if (res.success) {
      toastRef.value?.success(`插件 "${target}" 已安装${useLocal ? '（本地资源）' : ''}`)
      dobotPlusInstallName.value = ''
      await Promise.all([loadDobotPlusList(), loadDobotPlusCatalog(), loadDobotPlusLocal()])
    } else {
      toastRef.value?.error(`安装失败：${res.error?.message}`)
    }
  } catch (err) { toastRef.value?.error(`安装出错：${(err as Error).message}`) }
  finally {
    installingDobotPlus.value = false
    installingName.value = ''
  }
}

function onDobotPlusFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  dobotPlusUploadFile.value = input.files?.[0] ?? null
}

async function uploadDobotPlusPlugin() {
  const file = dobotPlusUploadFile.value
  if (!file || uploadingDobotPlus.value) return
  const name = file.name.replace(/\.zip$/i, '').trim()
  if (!name || !/^[A-Za-z0-9][\w.-]*$/.test(name)) {
    toastRef.value?.error('文件名需形如 <插件名>.zip，如 DobotES01_v1-0-3-stable.zip')
    return
  }
  uploadingDobotPlus.value = true
  try {
    const res = await api.uploadDobotPlusPlugin(deviceId, name, file)
    if (res.success) {
      toastRef.value?.success(`插件 "${name}" 上传并安装成功`)
      dobotPlusUploadFile.value = null
      await Promise.all([loadDobotPlusList(), loadDobotPlusCatalog()])
    } else {
      toastRef.value?.error(`安装失败：${res.error?.message}`)
    }
  } catch (err) { toastRef.value?.error(`上传出错：${(err as Error).message}`) }
  finally { uploadingDobotPlus.value = false }
}

async function uninstallDobotPlusPlugin(name: string) {
  confirmAction(`卸载插件「${name}」？`, async () => {
    try {
      const res = await api.manageDobotPlus(deviceId, name, 'uninstall')
      if (res.success) {
        toastRef.value?.success(`插件 "${name}" 已卸载`)
        if (activeDobotPlus.value === name || activeDobotPlusIframeName.value === name) closeDobotPlusPanel()
        await Promise.all([loadDobotPlusList(), loadDobotPlusCatalog(), loadDobotPlusLocal()])
      } else {
        toastRef.value?.error(`卸载失败：${res.error?.message}`)
      }
    } catch (err) { toastRef.value?.error(`卸载出错：${(err as Error).message}`) }
  }, '确认卸载')
}

/** 打开某个插件（顶部菜单入口：同时打开设置面板） */
async function openDobotPlusPlugin(name: string) {
  showSettings.value = true
  settingsTab.value = 'dobotplus'
  await Promise.all([loadDobotPlusLocal(), loadDobotPlusCatalog()])
  selectDobotPlusPlugin(name)
}

/** 本地 UI 目录与设备返回的插件名做大小写不敏感匹配（兼容只返回基础名的情况） */
function resolveLocalDobotPlusUiDir(name: string): string | null {
  const dirs = dobotPlusLocal.value
  if (dirs.some(p => p.name === name)) return name
  const lower = name.toLowerCase()
  const ci = dirs.find(p => p.name.toLowerCase() === lower)
  if (ci) return ci.name
  const base = lower.replace(/_(?:v|V)\d.*$/, '')
  const match = dirs.find(p => p.name.toLowerCase() === base || p.name.toLowerCase().startsWith(`${base}_`))
  return match ? match.name : null
}

function selectDobotPlusPlugin(name: string) {
  closeDobotPlusPanel()
  const dir = resolveLocalDobotPlusUiDir(name)
  if (dir) {
    activeDobotPlusIframe.value = dir
    activeDobotPlusIframeName.value = name
  } else {
    activeDobotPlus.value = name
  }
  dobotPlusCallFn.value = ''
  dobotPlusCallArgs.value = ''
  dobotPlusCallResult.value = null
  dobotPlusCallError.value = ''
}

function closeDobotPlusPanel() {
  activeDobotPlus.value = ''
  activeDobotPlusIframe.value = ''
  activeDobotPlusIframeName.value = ''
}

/** 与官方一致：本地插件界面加载后注入设备 IP / 设备信息，插件 UI 据此直连设备 HTTP API 与 MQTT */
function onDobotPlusIframeLoad() {
  const frame = dobotPlusIframeRef.value
  const ip = device.value?.ip
  if (!frame?.contentWindow || !ip) return
  const post = (payload: unknown) => frame.contentWindow?.postMessage(JSON.stringify(payload), '*')
  post({ method: 'syncIP', data: { ip, port: '22000' }, from: 'DobotStudio2020' })
  post({
    method: 'syncDeviceInfo',
    data: {
      portName: ip,
      deviceType: device.value?.type || '',
      deviceName: device.value?.name || '',
      cabinetType: '',
    },
    from: 'DobotStudio2020',
  })
  post({ method: 'changeLocale', data: 'zh-cn', from: 'DobotStudio2020' })
}

async function callDobotPlusMethod() {
  const fn = dobotPlusCallFn.value.trim()
  if (!activeDobotPlus.value || !fn || dobotPlusCalling.value || !isConnected.value) return
  let data: unknown = []
  const raw = dobotPlusCallArgs.value.trim()
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      dobotPlusCallError.value = '参数不是合法的 JSON，应为数组，如 [1]'
      return
    }
  }
  dobotPlusCalling.value = true
  dobotPlusCallResult.value = null
  dobotPlusCallError.value = ''
  try {
    const res = await api.callDobotPlus(deviceId, activeDobotPlus.value, fn, data)
    if (res.success) {
      dobotPlusCallResult.value = JSON.stringify(res.data ?? null, null, 2)
    } else {
      dobotPlusCallError.value = res.error?.message ?? '调用失败'
    }
  } catch (err) {
    dobotPlusCallError.value = (err as Error).message
  } finally {
    dobotPlusCalling.value = false
  }
}

// Watch settings tab to auto-load Dobot+
watch(settingsTab, (tab) => {
  if (tab === 'dobotplus') {
    loadDobotPlusList()
    loadDobotPlusCatalog()
    loadDobotPlusLocal()
  }
})

// ─── Trajectory Recording (controller SFTP) ────

interface TrajPoint {
  x: number; y: number; z: number
  rx: number; ry: number; rz: number
}

const showTrajectory = ref(false)
const trajRecording = ref(false)
const trajPoints = ref<TrajPoint[]>([])
const trajMovingIdx = ref(-1)
const savedTracks = ref<api.TrackFileItem[]>([])
const loadedTrackName = ref('')
const trajPlayingName = ref('')
const trajPlaybackPercent = ref(0)
const trajPlaybackTimes = ref(0)
let playbackStartTs = 0
let trajPlaybackDoneStreak = 0
let sawDragPlaybackTrue = false
const retraceMulti = ref(1)
const retraceUniform = ref(false)
const retraceLoop = ref(1)

const WORKSPACE_LIMITS = {
  x: { min: -550, max: 550 }, y: { min: -550, max: 550 }, z: { min: -100, max: 600 },
  rx: { min: -180, max: 180 }, ry: { min: -180, max: 180 }, rz: { min: -180, max: 180 },
}

/** Magician 工作空间（对称范围，可达半径 ~320mm；R 为绕 Z 旋转） */
const MAGICIAN_WORKSPACE_LIMITS = {
  x: { min: -300, max: 300 }, y: { min: -300, max: 300 }, z: { min: -300, max: 300 },
  r: { min: -180, max: 180 },
}

function getCurrentCartesian() {
  const s = state.value as Record<string, unknown>
  const pose = s?.pose as Record<string, number> | undefined
  if (!pose) return null
  return {
    x: pose.x ?? 0,
    y: pose.y ?? 0,
    z: pose.z ?? 0,
    // 控制器 exchange 常给 +180，UI 读取时规范化，避免 -180/180 看起来“错位”
    rx: normalizeEulerDeg(pose.rx ?? pose.r ?? 0),
    ry: normalizeEulerDeg(pose.ry ?? 0),
    rz: normalizeEulerDeg(pose.rz ?? 0),
    r: pose.r ?? 0,
  }
}

function checkPoseLegal(pt: TrajPoint): { legal: boolean; reason?: string } {
  if (isMagician.value) {
    // Magician 只校验 XYZR（R 由调用方写入 rz 槽位）
    const r = pt.rz ?? pt.rx ?? 0
    const limits: Array<{ key: keyof typeof MAGICIAN_WORKSPACE_LIMITS; value: number }> = [
      { key: 'x', value: pt.x }, { key: 'y', value: pt.y }, { key: 'z', value: pt.z },
      { key: 'r', value: r },
    ]
    for (const { key, value } of limits) {
      const lim = MAGICIAN_WORKSPACE_LIMITS[key]
      if (value < lim.min || value > lim.max) return { legal: false, reason: `${key.toUpperCase()} = ${value.toFixed(2)} 超出范围 [${lim.min}, ${lim.max}]` }
    }
  } else {
    const limits: Array<{ key: keyof typeof WORKSPACE_LIMITS; value: number }> = [
      { key: 'x', value: pt.x }, { key: 'y', value: pt.y }, { key: 'z', value: pt.z },
      { key: 'rx', value: pt.rx }, { key: 'ry', value: pt.ry }, { key: 'rz', value: pt.rz },
    ]
    for (const { key, value } of limits) {
      const lim = WORKSPACE_LIMITS[key]
      if (value < lim.min || value > lim.max) return { legal: false, reason: `${key.toUpperCase()} = ${value.toFixed(2)} 超出范围 [${lim.min}, ${lim.max}]` }
    }
  }
  if (emergencyStop.value) return { legal: false, reason: '急停中' }
  if (isCollision.value) return { legal: false, reason: '碰撞检测触发' }
  return { legal: true }
}

async function loadTracksList() {
  const res = await api.listTracks(deviceId)
  if (res.success && res.data) savedTracks.value = res.data
}

async function startTrajRecord() {
  if (!checkEnabled()) return
  const res = await api.startTrackRecording(deviceId)
  if (res.success) {
    trajRecording.value = true
    toastRef.value?.info('已进入拖拽录制 — 请拖动机器臂，完成后点「保存」或按末端按键')
    pollTrajRecordStatus()
  } else {
    toastRef.value?.error(`录制失败: ${res.error?.message}`)
  }
}

async function stopTrajRecord() {
  const res = await api.stopTrackRecording(deviceId)
  trajRecording.value = false
  stopTrajRecordPoll()
  if (res.success) {
    toastRef.value?.success('轨迹已保存到控制器')
    await loadTracksList()
  } else {
    toastRef.value?.error(`保存失败: ${res.error?.message}`)
  }
}

let trajRecordPollTimer: number | null = null
function pollTrajRecordStatus() {
  if (trajRecordPollTimer !== null) return
  const tick = async () => {
    const res = await api.getRecordStatus(deviceId)
    if (res.success && res.data) {
      if (!res.data.recording) {
        trajRecording.value = false
        stopTrajRecordPoll()
        if (res.data.isFinish) {
          toastRef.value?.info('录制已结束（末端按键触发），轨迹已保存')
          await loadTracksList()
        }
        return
      }
      trajRecordPollTimer = window.setTimeout(tick, 1500)
    } else {
      trajRecordPollTimer = window.setTimeout(tick, 2000)
    }
  }
  trajRecordPollTimer = window.setTimeout(tick, 1000)
}
function stopTrajRecordPoll() {
  if (trajRecordPollTimer !== null) {
    clearTimeout(trajRecordPollTimer)
    trajRecordPollTimer = null
  }
}

async function loadTrackPoints(trackName: string) {
  const res = await api.getTrackContent(deviceId, trackName)
  if (!res.success) {
    toastRef.value?.error(`加载失败: ${res.error?.message}`)
    return
  }
  const text = res.data ?? ''
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const header = (lines.shift() ?? '').split(',')
  // 表头匹配大小写不敏感（x/y/z/rx/ry/rz 或 X/Y/Z/RX/RY/RZ）
  const lowerHeader = header.map(h => h.trim().toLowerCase())
  const xIdx = lowerHeader.indexOf('x'), yIdx = lowerHeader.indexOf('y'), zIdx = lowerHeader.indexOf('z')
  const rxIdx = lowerHeader.indexOf('rx'), ryIdx = lowerHeader.indexOf('ry'), rzIdx = lowerHeader.indexOf('rz')
  const dataRows = lines.filter(l => l.trim())
  loadedTrackName.value = trackName
  if (dataRows.length === 0) {
    trajPoints.value = []
    toastRef.value?.info(`${trackName} 是空文件或只有表头，无法预览点位`)
    return
  }
  if (xIdx < 0 || yIdx < 0 || zIdx < 0) {
    trajPoints.value = []
    toastRef.value?.info(`${trackName} 无位姿列（${dataRows.length} 行数据），仅支持直接复现`)
    return
  }
  const points: TrajPoint[] = []
  for (const line of dataRows) {
    const cols = line.split(',')
    if (cols.length < Math.max(xIdx, yIdx, zIdx, rxIdx, ryIdx, rzIdx) + 1) continue
    points.push({
      x: Number(cols[xIdx] || 0), y: Number(cols[yIdx] || 0), z: Number(cols[zIdx] || 0),
      rx: Number(cols[rxIdx] || 0), ry: Number(cols[ryIdx] || 0), rz: Number(cols[rzIdx] || 0),
    })
  }
  trajPoints.value = points
  toastRef.value?.success(`已加载 ${trackName} (${trajPoints.value.length} 个点)`)
}

/** 与服务端录制状态同步：页面刷新 / 多端操作后保持按钮状态正确 */
async function syncTrajRecordStatus() {
  const res = await api.getRecordStatus(deviceId)
  if (res.success && res.data) {
    trajRecording.value = res.data.recording
    if (res.data.recording) pollTrajRecordStatus()
  }
}

async function startTrackPlayback(trackName: string) {
  if (!checkEnabled()) return
  // 复现前先按面板当前参数下发（次数/倍率/匀速），避免控制器沿用上次保存的“无限/多次”设置
  const paramsRes = await applyRetraceParams()
  if (!paramsRes) {
    toastRef.value?.error('复现参数下发失败，未开始复现')
    return
  }
  const res = await api.startTrackPlayback(deviceId, `${trackName}.csv`)
  if (res.success) {
    trajPlayingName.value = trackName
    trajPlaybackPercent.value = 0
    trajPlaybackTimes.value = 0
    trajPlaybackDoneStreak = 0
    sawDragPlaybackTrue = false
    playbackStartTs = Date.now()
    toastRef.value?.success(`开始复现 ${trackName}`)
    pollTrackPlaybackStatus()
  } else {
    toastRef.value?.error(`复现失败: ${res.error?.message}`)
  }
}

async function stopTrackPlayback(trackName?: string) {
  const file = trackName ? `${trackName.replace(/\.csv$/i, '')}.csv` : undefined
  const res = await api.stopTrackPlayback(deviceId, file)
  if (res.success) {
    trajPlayingName.value = ''
    trajPlaybackPercent.value = 0
    trajPlaybackTimes.value = 0
    trajPlaybackDoneStreak = 0
    stopTrackPlaybackPoll()
    toastRef.value?.info('已停止复现')
  } else {
    toastRef.value?.error(`停止失败: ${res.error?.message} — 若机械臂仍在运动，请使用急停`)
  }
}

let trajPlaybackPollTimer: number | null = null
function pollTrackPlaybackStatus() {
  if (trajPlaybackPollTimer !== null) return
  const tick = async () => {
    const res = await api.getTrackPlaybackStatus(deviceId)
    if (res.success && res.data) {
      const st = res.data
      const elapsed = Date.now() - playbackStartTs
      // 控制器可能返回 0~1 或 0~100 的进度，统一成百分比
      const rawPercent = st.percent || 0
      const pct = rawPercent > 0 && rawPercent <= 1 ? rawPercent * 100 : rawPercent
      trajPlaybackPercent.value = Math.max(0, Math.min(100, Math.round(pct)))
      trajPlaybackTimes.value = st.currentTimes || 0
      const stateObj = state.value as Record<string, unknown>
      const dragPlayback = stateObj.dragPlayback
      // 控制器 exchange 状态里的 dragPlayback 是“是否正在轨迹复现”的权威标志：
      //  - true：机械臂确实在复现，停止按钮必须保留，继续轮询
      //  - 看到过 true 后再变 false：复现真正结束
      //  - 一直 false：可能是固件不上报或还没开始，最多等 30 秒，停止按钮全程保留
      if (typeof dragPlayback === 'boolean') {
        if (dragPlayback) {
          sawDragPlaybackTrue = true
          trajPlaybackPollTimer = window.setTimeout(tick, 1000)
          return
        }
        if (sawDragPlaybackTrue) {
          clearPlaybackState()
          toastRef.value?.success(pct >= 100 ? '轨迹复现完成' : '轨迹复现已结束')
          return
        }
        if (elapsed >= 30000) {
          clearPlaybackState()
          toastRef.value?.info('未检测到复现状态变化，已退出播放态；请确认机械臂已停止')
          return
        }
        trajPlaybackPollTimer = window.setTimeout(tick, 1000)
        return
      }
      // 兜底：控制器不上报 dragPlayback 时，
      // 必须“isDone 且进度 100%”连续两拍且启动满 3 秒，才判定完成。
      if (st.isDone && pct >= 100) trajPlaybackDoneStreak++
      else trajPlaybackDoneStreak = 0
      if (elapsed >= 3000 && trajPlaybackDoneStreak >= 2) {
        clearPlaybackState()
        toastRef.value?.success('轨迹复现完成')
        return
      }
      trajPlaybackPollTimer = window.setTimeout(tick, 1000)
    } else {
      trajPlaybackPollTimer = window.setTimeout(tick, 2000)
    }
  }
  trajPlaybackPollTimer = window.setTimeout(tick, 1000)
}
function clearPlaybackState() {
  trajPlayingName.value = ''
  trajPlaybackPercent.value = 0
  trajPlaybackTimes.value = 0
  trajPlaybackDoneStreak = 0
  sawDragPlaybackTrue = false
  stopTrackPlaybackPoll()
}
function stopTrackPlaybackPoll() {
  if (trajPlaybackPollTimer !== null) {
    clearTimeout(trajPlaybackPollTimer)
    trajPlaybackPollTimer = null
  }
}

/** 从控制器读取复现参数并回填到面板（与官方高级设置一致） */
async function loadRetraceParams() {
  const res = await api.getTrackPlaybackParams(deviceId)
  if (res.success && res.data) {
    retraceMulti.value = res.data.multi ?? 1
    retraceUniform.value = (res.data.const ?? 0) === 1
    retraceLoop.value = res.data.loop ?? 1
  }
}

/** 把面板参数下发到控制器，成功返回 true */
async function applyRetraceParams(): Promise<boolean> {
  const res = await api.setTrackPlaybackParams(deviceId, {
    multi: retraceMulti.value,
    const: retraceUniform.value ? 1 : 0,
    loop: Math.max(1, Math.min(1000, Math.round(retraceLoop.value || 1))),
  })
  return res.success
}

async function saveRetraceParams() {
  if (await applyRetraceParams()) toastRef.value?.success('复现参数已保存')
  else toastRef.value?.error('复现参数保存失败')
}

async function renameTrack(trackName: string) {
  const newName = window.prompt(`重命名 "${trackName}"（不含 .csv）`, trackName)
  const clean = (newName ?? '').trim().replace(/\.csv$/i, '')
  if (!newName || clean === trackName) return
  const res = await api.renameTrack(deviceId, trackName, clean)
  if (res.success) {
    toastRef.value?.success(`已重命名为 ${clean}`)
    if (loadedTrackName.value === trackName) loadedTrackName.value = clean
    await loadTracksList()
  } else {
    toastRef.value?.error(`重命名失败: ${res.error?.message}`)
  }
}

async function deleteTrack(trackName: string) {
  if (!window.confirm(`确认删除轨迹 "${trackName}"？`)) return
  const res = await api.deleteTrack(deviceId, trackName)
  if (res.success) {
    toastRef.value?.success(`已删除 ${trackName}`)
    if (loadedTrackName.value === trackName) {
      trajPoints.value = []
      loadedTrackName.value = ''
    }
    await loadTracksList()
  } else {
    toastRef.value?.error(`删除失败: ${res.error?.message}`)
  }
}

async function goToTrajPoint(i: number) {
  if (!checkEnabled()) return
  const pt = trajPoints.value[i]
  if (!pt) return
  const check = checkPoseLegal(pt)
  if (!check.legal) { toastRef.value?.error(`安全校验失败: ${check.reason}`); return }
  trajMovingIdx.value = i
  try {
    const joints = state.value.joints as Record<string, number> | undefined
    const jointNear = joints
      ? [1, 2, 3, 4, 5, 6].map(j => Number(joints['j' + j] ?? 0))
      : undefined
    const res = await api.moveCartesian(deviceId, {
      x: pt.x, y: pt.y, z: pt.z,
      rx: pt.rx, ry: pt.ry, rz: pt.rz,
      jointNear,
    })
    if (res.success) toastRef.value?.success(`已到达轨迹点 #${i + 1}`)
    else toastRef.value?.error(`移动失败: ${res.error?.message}`)
  } catch (err) { toastRef.value?.error(`移动错误: ${(err as Error).message}`) }
  finally { trajMovingIdx.value = -1 }
}

// Auto-load tracks list when panel opens
watch(showTrajectory, (v) => {
  if (v) {
    loadTracksList()
    syncTrajRecordStatus()
    loadRetraceParams()
  } else {
    stopTrajRecordPoll()
    stopTrackPlaybackPoll()
  }
})

function loadSettingsTabData(tab: string) {
  if (tab === 'system') {
    loadSystemTime()
    loadAlias()
  }
  else if (tab === 'users') loadUsers()
  else if (tab === 'coordinates') loadCoords()
  else if (tab === 'load') loadLoadData()
  else if (tab === 'postures') loadPostures()
  else if (tab === 'motion') loadAllMotionParams()
  else if (tab === 'comm') { loadWiFi(); loadEthernet(); loadBus() }
  else if (tab === 'key') { loadButtonMode(); loadButtonProjects() }
  else if (tab === 'power') loadCCBoxVoltage()
  else if (tab === 'remote') { loadRemoteIO(); loadRemoteModbus(); loadButtonProjects() }
  else if (tab === 'drag') loadDragSensivity()
  else if (tab === 'dobotplus') { loadDobotPlusList(); loadDobotPlusCatalog(); loadDobotPlusLocal() }
  else if (tab === 'docat') loadCalibExportDir()
  resetSettingsEditState()
}

// Watch settings tab to auto-load
watch(settingsTab, (tab) => {
  loadSettingsTabData(tab)
})

// ─── Lifecycle ──────────────────────────────────

let fallbackTimer: ReturnType<typeof setInterval> | null = null
let wsDisconnected = false

onMounted(async () => {
  void import('./ProgrammingView.vue')
  window.addEventListener('message', handle3DModelMessage)
  window.addEventListener('blur', onWindowBlur)
  // 捕获阶段挂 window：不依赖 .device-page 焦点，长按方向键也能 preventDefault 挡住 F7 光标
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  await load()
  if (!isMock && !isConnected.value) await doConnect()
  if (!isMock && isConnected.value) {
    loadSpeed()
    ensureJogReadyBackground()
  }
  loadLoadData()
  api.getAutoManualSwitch(deviceId).then(r => { if (r.success && r.data) autoModeEnabled.value = r.data.value })
  api.getRemoteControl(deviceId).then(r => { if (r.success && r.data) isOnlineMode.value = r.data.mode === 'online' })
  void checkDeviceTimeOnEntry()

  // Mock 模式跳过 WS 订阅和 REST 兜底轮询，避免覆盖 mock 状态
  if (isMock) {
    ;(document.querySelector('.device-page') as HTMLElement)?.focus()
    return
  }

  // WS 主通道：订阅设备状态
  wsClient.subscribe(deviceId)

  wsClient.onState((devId, s) => {
    if (devId !== deviceId || !s) return
    const raw = s as unknown as Record<string, unknown>
    if (isMock) { console.warn('[Mock] WS onState unexpectedly fired — ignoring'); return }
    console.log('[State] WS onState update')
    const ext = raw._ext as Record<string, unknown> | undefined
    state.value = raw
    deviceStore.setState(deviceId, raw)
    // 首次状态到达：自动填关节目标 + 笛卡尔位姿（避免打开是 0 0 0 0 0 0）
    if (!moveTargetInit.value && fillMoveTargetsFromState()) {
      moveTargetInit.value = true
    }
    // Update enabled state
    const status = raw.status as Record<string, unknown> | undefined
    enabled.value = status?.mode === 'auto'
    deviceStore.setEnabled(deviceId, enabled.value)
    // Parse alarm info from WS ext payload
    if (ext) {
      isAutoMode.value = (ext.autoManual as number) === 1
      // 对齐官方：isAlarmUpdate / isWarningUpdate 时立刻上屏轻量数据，并主动拉完整详情
      // exchange 的 alarms/warningList 仅在 update 标志为 true 时可靠
      const isAlarmUpdate = (ext.isAlarmUpdate as boolean) || false
      const isWarningUpdate = (ext.isWarningUpdate as boolean) || false
      if (isAlarmUpdate) {
        // WS 推送的是 DeviceState.alarm；REST status 则是 alarms 字段
        applyRealtimeAlarms(raw.alarms ?? raw.alarm)
        // 不依赖“是否有新 ID”——清除/等级变化/同 ID 更新都要拉详情
        void fetchAlarmDetails()
      }
      if (isWarningUpdate) {
        applyRealtimeWarnings(ext.warningList)
        void fetchWarningDetails()
      }
      // 同步点动坐标系（控制器 coordinate: 0=joint, 非0=cartesian）
      if (ext.coordinate !== undefined) {
        syncJogCoordinateFromController(ext.coordinate)
      }
      isCollision.value = (ext.isCollision as boolean) || false
      protectiveStop.value = (ext.protectiveStop as boolean) || false
      emergencyStop.value = (ext.emergencyStop as boolean) || false
      // TCP 状态（exclusive 模式；串口设备无 TCP，视为正常）
      if (ext.mode === 'exclusive') {
        tcpDown.value = ext.serial ? false : !(ext.tcpConnected as boolean)
      } else {
        tcpDown.value = false
      }
    }
  })
  wsClient.onOnline((id) => {
    if (id === deviceId) {
      deviceStore.setConnected(deviceId, true)
      loadLoadData()
      api.getAutoManualSwitch(deviceId).then(r => { if (r.success && r.data) autoModeEnabled.value = r.data.value })
      api.getRemoteControl(deviceId).then(r => { if (r.success && r.data) isOnlineMode.value = r.data.mode === 'online' })
    }
  })
  wsClient.onOffline((id) => { if (id === deviceId) deviceStore.setOffline(deviceId) })

  // WS 断线兜底：低频 REST 轮询
  wsDisconnected = wsClient.isDisconnected
  fallbackTimer = setInterval(async () => {
    if (!wsClient.isDisconnected) {
      wsDisconnected = false
      return
    }
    wsDisconnected = true
    try {
      const s = await api.getDeviceStatus(deviceId)
      if (s.success && s.data) {
        const fb = s.data as Record<string, unknown>
        deviceStore.setConnected(deviceId, s.data.connected, (fb.mode as 'exclusive' | 'virtual') ?? null)
        if (s.data.state) {
          if (isMock) { console.warn('[Mock] REST fallback unexpectedly set state — skipping'); }
          else { state.value = s.data.state; deviceStore.setState(deviceId, s.data.state) }
          if (!moveTargetInit.value && fillMoveTargetsFromState()) {
            moveTargetInit.value = true
          }
        }
        const status = s.data.status as Record<string, unknown> | undefined
        enabled.value = status?.mode === 'auto'
        deviceStore.setEnabled(deviceId, enabled.value)
        // 只在 isAlarmUpdate/isWarningUpdate 时刷新，避免空数组覆盖
        const isAlarmUpd = (fb.isAlarmUpdate as boolean) || false
        const isWarningUpd = (fb.isWarningUpdate as boolean) || false
        if (isAlarmUpd) {
          const stateObj = fb.state as Record<string, unknown> | undefined
          applyRealtimeAlarms(fb.alarms ?? stateObj?.alarm)
          void fetchAlarmDetails()
        }
        if (isWarningUpd) {
          applyRealtimeWarnings(fb.warningList)
          void fetchWarningDetails()
        }
        if (fb.coordinate !== undefined) {
          syncJogCoordinateFromController(fb.coordinate)
        }
        isCollision.value = (fb.isCollision as boolean) || false
        protectiveStop.value = (fb.protectiveStop as boolean) || false
        emergencyStop.value = (fb.emergencyStop as boolean) || false
        // TCP 状态
        if (fb.mode === 'exclusive') {
          tcpDown.value = !(fb.tcpConnected as boolean)
        } else {
          tcpDown.value = false
        }
      }
    } catch { /* ignore */ }
  }, 3000) // 兜底轮询 3s，比 REST 主通道慢 6 倍
})

onUnmounted(() => {
  window.removeEventListener('message', handle3DModelMessage)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('keyup', onKeyUp, true)
  if (fallbackTimer) clearInterval(fallbackTimer)
  stopES01StatusPoll()
  stopJog()
  cancelMockMove()
  keysDown.clear()
  wsClient.unsubscribe(deviceId)
})
</script>

<style scoped>
.device-page { padding: 40px 48px; max-width: 1600px; margin-inline: auto; min-height: 100vh; outline: none; }
.workspace-header {
  display: grid; grid-template-columns: minmax(360px, 1fr) auto minmax(360px, 1fr);
  align-items: center; gap: 16px; padding-bottom: 12px;
}
.workspace-header-left { display: flex; align-items: center; gap: 20px; min-width: 0; }
.workspace-header-center { display: flex; align-items: center; justify-content: center; min-width: 0; }
.workspace-header-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.back-btn { display: flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 0.82rem; font-weight: 500; color: var(--text-muted); text-decoration: none; transition: color var(--duration-fast); padding: 6px 0; }
.back-btn:hover { color: var(--cyan-300); }
.top-bar-device h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
.top-bar-ip { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; display: block; }
.workspace-switch { display: flex; align-items: center; gap: 2px; }
.workspace-switch-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 0 12px;
  border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted);
  font-family: var(--font-body); font-size: 0.72rem; font-weight: 500;
  text-decoration: none; white-space: nowrap;
}
.workspace-switch-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.workspace-switch-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.workspace-switch-btn:hover { border-color: var(--border-bright); color: var(--text-primary); }
.workspace-switch-btn:active { transform: translateY(1px); }
.workspace-switch-btn--active { border-color: var(--cyan-500); background: var(--cyan-900); color: var(--cyan-300); }
.connection-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: var(--radius); font-family: var(--font-body); font-size: 0.78rem; font-weight: 600; border: 1px solid; }
.bic { display: inline-flex; align-items: center; margin-right: 5px; }
.bic svg { display: block; }
.btn-ic { display: inline-flex; align-items: center; justify-content: center; padding: 3px 6px; }
.btn-ic svg { display: block; }
.connection-badge--online { border-color: var(--status-online); color: var(--status-online); background: var(--status-online-dim); }
.connection-badge--virtual { border-color: var(--status-virtual); color: var(--status-virtual); background: var(--status-virtual-dim); }
.connection-badge--warning { border-color: var(--status-warning); color: var(--status-warning); background: var(--status-warning-dim); }
.connection-badge--offline { border-color: var(--status-offline); color: var(--status-offline); background: var(--status-offline-dim); }

/* Enable Toggle Switch */
.toggle-switch { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.toggle-switch input { display: none; }
.toggle-track {
  width: 36px; height: 20px; border-radius: 10px;
  background: var(--surface-2); border: 1px solid var(--border);
  position: relative; transition: all var(--duration-fast);
}
.toggle-switch input:checked + .toggle-track {
  background: var(--cyan-900); border-color: var(--cyan-500);
}
.toggle-thumb {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--text-muted);
  transition: all var(--duration-fast) var(--ease-out);
}
.toggle-switch input:checked + .toggle-track .toggle-thumb {
  left: 18px; background: var(--cyan-300);
}
.toggle-label {
  display: flex; flex-direction: column; align-items: flex-start;
  justify-content: center;
  gap: 1px;
  min-width: 72px; /* 预留负载行宽度（约 300g(load1)），切换使能时右侧按钮不位移 */
  font-family: var(--font-body); font-size: 0.72rem; font-weight: 500;
  color: var(--text-muted);
  line-height: 1.2;
}
.toggle-label-main { font-size: 0.72rem; font-weight: 500; }
.toggle-label-main.is-on { font-size: 0.6rem; font-weight: 600; }
.toggle-label-load {
  font-family: var(--font-mono); font-size: 0.66rem; font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  max-width: 72px; /* 与 .toggle-label 的 min-width 一致，超长预设名省略号截断 */
  overflow: hidden;
  text-overflow: ellipsis;
}
.toggle-label-load.is-inactive { display: none; }
.toggle-switch input:checked ~ .toggle-label { color: var(--cyan-300); }

.status-grid { display: grid; grid-template-columns: minmax(240px, 0.85fr) minmax(300px, 1fr) minmax(420px, 1.45fr); gap: 16px; align-items: stretch; }
.control-grid { display: grid; grid-template-columns: minmax(420px, 1.05fr) minmax(420px, 0.95fr); gap: 16px; align-items: stretch; }
.pose-card, .joint-card, .model-panel, .jog-panel, .move-panel { min-width: 0; }
.jog-panel:focus { outline: 1px solid var(--cyan-500); outline-offset: 2px; }
@media (max-width: 1200px) {
  .workspace-header { grid-template-columns: 1fr; align-items: stretch; }
  .workspace-header-center { justify-content: flex-start; }
  .workspace-header-actions { justify-content: flex-start; }
  .status-grid { grid-template-columns: 1fr 1fr; }
  .model-panel { grid-column: 1 / -1; }
  .control-grid { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .status-grid { grid-template-columns: 1fr; }
  .model-panel { grid-column: auto; }
}
.hud-label { font-family: var(--font-body); font-size: 0.72rem; font-weight: 600; color: var(--text-muted); margin-bottom: 16px; }
.pose-hud-label { display: flex; align-items: center; justify-content: space-between; }
.btn-icon--copy { width: 24px; height: 24px; font-size: 0; }
.pose-readout { display: flex; flex-direction: column; gap: 6px; }
.pose-axis-row { display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; background: var(--surface-1); border-radius: var(--radius); }
.pose-axis-label { font-family: var(--font-mono); font-size: 0.82rem; font-weight: 600; color: var(--text-muted); width: 20px; }
.pose-axis-value { font-family: var(--font-mono); font-size: 1.6rem; font-weight: 500; color: var(--text-primary); flex: 1; text-align: right; letter-spacing: -0.02em; }
.pose-axis-unit { font-size: 0.72rem; color: var(--text-muted); width: 24px; }

.model-panel { position: relative; padding: 0; overflow: hidden; }
.model-panel-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border-bottom: 1px solid var(--border);
}
.model-subtitle { margin-top: 3px; font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-muted); }
.model-frame-shell { position: relative; height: 320px; background: var(--void-deep); }
.model-frame { display: block; width: 100%; height: 100%; border: 0; background: var(--void-deep); }
.model-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px;
  background: rgba(8,9,10,0.78); color: var(--text-muted); pointer-events: none;
  font-family: var(--font-body); font-size: 0.78rem;
}
.loading-ring {
  width: 18px; height: 18px; border: 2px solid rgba(122, 162, 255, 0.22);
  border-top-color: var(--cyan-300); border-radius: 50%; animation: spin 0.8s linear infinite;
}

/* 标定辅助面板 */
.model-panel-actions { display: flex; align-items: center; gap: 8px; }
.btn-icon--active { border-color: var(--cyan-500); color: var(--cyan-300); background: var(--cyan-900); }
.btn-icon--convert { width: 30px; height: 30px; font-size: 0; }
.calib-panel {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px; max-height: 440px; min-height: 260px;
}
.calib-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.calib-toolbar label {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--font-body); font-size: 0.66rem; font-weight: 500; color: var(--text-muted);
  white-space: nowrap;
}
.calib-select {
  padding: 2px 4px; font-family: var(--font-mono); font-size: 0.68rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.calib-select:focus, .calib-thresh-input:focus, .calib-rowcount-input:focus { border-color: var(--accent); }
.calib-thresh-input {
  width: 52px; padding: 2px 4px; font-family: var(--font-mono); font-size: 0.68rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); text-align: center; outline: none;
}
.calib-rowcount-input {
  width: 46px; padding: 2px 4px; font-family: var(--font-mono); font-size: 0.68rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); text-align: center; outline: none;
}
.calib-rmse { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-secondary); white-space: nowrap; }
.calib-rmse--bad { color: var(--status-danger); }
.calib-table-wrap { overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius); }
.calib-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 0.68rem; }
.calib-table th {
  text-align: left; padding: 5px 6px; font-family: var(--font-body); font-size: 0.62rem; font-weight: 600;
  color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); background: var(--void-surface); position: sticky; top: 0;
}
.calib-table td { padding: 3px 5px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); }
.calib-table tr:last-child td { border-bottom: none; }
.calib-table input {
  width: 100%; min-width: 0; box-sizing: border-box; padding: 2px 5px;
  font-family: var(--font-mono); font-size: 0.68rem; text-align: right;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.calib-table input:focus { border-color: var(--accent); }
.calib-table input::-webkit-outer-spin-button,
.calib-table input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.calib-idx { color: var(--text-muted); text-align: center; }
.calib-row--inactive { opacity: 0.45; }
.calib-convert {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-top: 10px; border-top: 1px solid var(--border);
}
.calib-convert-label { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
.calib-convert-input {
  flex: 1; min-width: 150px; padding: 5px 8px;
  font-family: var(--font-mono); font-size: 0.74rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.calib-convert-input:focus { border-color: var(--accent); }
.calib-convert-result { color: var(--cyan-300); }
.btn-icon--toolbar { width: 24px; height: 24px; font-size: 0; }
.calib-paste-box {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; border: 1px solid var(--cyan-500); border-radius: var(--radius);
  background: var(--cyan-900);
}
.calib-paste-hint { font-family: var(--font-body); font-size: 0.64rem; color: var(--cyan-300); }
.calib-paste-input {
  width: 100%; box-sizing: border-box; padding: 6px 8px;
  font-family: var(--font-mono); font-size: 0.72rem; line-height: 1.4;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none; resize: vertical;
}
.calib-paste-input:focus { border-color: var(--accent); }
.calib-paste-actions { display: flex; gap: 6px; }
.joint-readout { display: flex; flex-direction: column; gap: 5px; }
.joint-row { display: flex; align-items: center; gap: 10px; }
.joint-label { font-family: var(--font-mono); font-size: 0.72rem; font-weight: 600; color: var(--text-muted); width: 22px; text-align: right; }
.joint-gauge { flex: 1; }
.joint-gauge-track { height: 4px; background: var(--surface-2); border-radius: 2px; position: relative; overflow: hidden; }
.joint-gauge-fill { height: 100%; background: linear-gradient(90deg, var(--cyan-700), var(--cyan-400)); border-radius: 2px; transition: width 0.3s var(--ease-out); }
.joint-gauge-center { position: absolute; top: -3px; left: 50%; transform: translateX(-50%); width: 2px; height: 10px; background: var(--text-muted); border-radius: 1px; }
.joint-value { font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-secondary); width: 60px; text-align: right; }

.jog-panel-main { display: flex; gap: 16px; align-items: stretch; }
.jog-panel-main-left { flex: 1; min-width: 0; }
.jog-panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.jog-settings { display: flex; align-items: stretch; gap: 16px; flex-wrap: wrap; }
.jog-settings-rows { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.jog-settings-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
/* 手动自动 开关的 开/关 标签只需单字宽度，去掉 72px 预留，让 自动/手动 与 行2 连续/步进 对齐 */
.jog-settings .toggle-label { min-width: 0; }
/* 设备朝向板块：占三行高度（表头两行 + jog 按钮行），顶部对齐，无卡片样式 */
.device-orientation {
  display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start;
  gap: 8px;
}
.device-orientation-title { font-family: var(--font-body); font-size: 0.72rem; font-weight: 500; color: var(--text-muted); }
.mode-switch-group { display: flex; align-items: center; gap: 6px; }
.amp-limit { display: flex; align-items: center; gap: 4px; }
.amp-limit-label { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); }
.amp-input {
  width: 48px; padding: 2px 6px; font-family: var(--font-mono); font-size: 0.74rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); text-align: center; outline: none;
}
.amp-input:focus { border-color: var(--accent); }
.amp-limit-unit { font-family: var(--font-body); font-size: 0.62rem; color: var(--text-muted); }

.jog-mode-selector { display: flex; gap: 2px; }
.jog-mode-btn { padding: 4px 12px; border: 1px solid var(--border); background: transparent; cursor: pointer; font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); transition: all var(--duration-fast); }
.jog-mode-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.jog-mode-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.jog-mode-btn--active { background: var(--cyan-900); border-color: var(--cyan-500); color: var(--cyan-300); }
.jog-mode-btn:hover:not(.jog-mode-btn--active) { color: var(--text-primary); border-color: var(--border-bright); }
.jog-mode-btn:active { transform: translateY(1px); }

/* WASD 方向十字选择器：设备朝向板块内，中心指针指示 W 指向 */
.wasd-dir-picker {
  display: grid;
  grid-template-columns: repeat(3, 26px);
  grid-template-rows: repeat(3, 26px);
  gap: 2px;
}
.wasd-dir-btn--c { grid-area: 1 / 2; }
.wasd-dir-btn--a { grid-area: 2 / 1; }
.wasd-dir-btn--b { grid-area: 2 / 3; }
.wasd-dir-btn--d { grid-area: 3 / 2; }
.wasd-dir-btn {
  width: 26px; height: 26px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border);
  border-radius: 4px; cursor: pointer; color: var(--text-muted);
  line-height: 1; transition: all var(--duration-fast);
}
.wasd-dir-btn--active { background: var(--cyan-900); border-color: var(--cyan-500); color: var(--cyan-300); }
.wasd-dir-btn:hover:not(.wasd-dir-btn--active) { color: var(--text-primary); border-color: var(--border-bright); }
.wasd-dir-btn:active { transform: translateY(1px); }
.wasd-dir-center {
  grid-area: 2 / 2;
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary); pointer-events: none;
}
.inch-setting { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.inch-preset {
  min-width: 38px; height: 22px; padding: 0 6px; border: 1px solid var(--border);
  background: var(--void-deep); color: var(--text-muted); border-radius: var(--radius);
  cursor: pointer; font-family: var(--font-mono); font-size: 0.66rem;
}
.inch-preset--active { border-color: var(--cyan-500); color: var(--cyan-300); background: var(--cyan-900); }

/* Jog Grid — 六轴横排，每轴纵向一列 */
.jog-grid { display: flex; gap: 8px; justify-content: center; padding: 8px 0; }
.jog-axis-col { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 56px; }
.jog-axis-name { font-family: var(--font-mono); font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); }
.jog-axis-val { font-family: var(--font-mono); font-size: 0.74rem; color: var(--cyan-300); }
.jog-shortcut-hints {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 14px;
  padding: 4px 0 2px; border-top: 1px solid var(--border); margin-top: 6px;
}
.jog-shortcut-hints-break { flex-basis: 100%; width: 0; height: 0; }
.jog-shortcut-hint {
  font-family: var(--font-body); font-size: 0.62rem; color: var(--text-muted);
  display: inline-flex; align-items: center; gap: 4px;
}
.jog-shortcut-hint b { color: var(--text-secondary); font-weight: 600; min-width: 18px; }
.jog-shortcut-hint kbd {
  font-family: var(--font-mono); font-size: 0.58rem; padding: 1px 5px;
  border: 1px solid var(--border); border-radius: 3px; background: var(--void-deep);
  color: var(--text-secondary);
}
/* 模拟键盘键位错位：↓ 按钮整排右移 */
.jog-btn--down { transform: translateX(16px); }
.jog-btn { width: 48px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; color: var(--text-secondary); transition: all 80ms var(--ease-out); user-select: none; touch-action: none; }
.jog-btn:hover:not(:disabled) { border-color: var(--border-bright); color: var(--text-primary); }
.jog-btn:active:not(:disabled), .jog-btn--active { background: var(--cyan-900); border-color: var(--cyan-500); color: var(--cyan-300); }
.jog-btn:active:not(:disabled):not(.jog-btn--down), .jog-btn--active:not(.jog-btn--down) { transform: scale(0.95); }
.jog-btn--active.jog-btn--down { transform: translateX(16px) scale(0.95); }
.jog-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.jog-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.action-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.move-path-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border);
}

/* Speed Slider */
.speed-control {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 14px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-0);
}
.speed-control--disabled { opacity: 0.35; pointer-events: none; }
.speed-label {
  font-family: var(--font-body); font-size: 0.72rem; font-weight: 500;
  color: var(--text-muted); white-space: nowrap;
}
.speed-slider {
  -webkit-appearance: none; appearance: none;
  width: 140px; height: 4px; border-radius: 2px; outline: none;
  background: var(--surface-2); cursor: pointer;
}
.speed-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--cyan-400); border: 2px solid var(--cyan-300);
  cursor: pointer;
  transition: transform 0.1s var(--ease-out);
}
.speed-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
.speed-slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--cyan-400); border: 2px solid var(--cyan-300);
  cursor: pointer;
}
.speed-value {
  font-family: var(--font-mono); font-size: 0.82rem; font-weight: 600;
  color: var(--text-primary); min-width: 42px; text-align: right;
}
.action-sep { width: 1px; height: 24px; background: var(--border); margin: 0 4px; }

/* Move Panel */
.move-panel-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.move-panel-actions { display: flex; gap: 6px; }
.preset-name-input {
  width: 160px; padding: 6px 8px; font-family: var(--font-mono); font-size: 0.74rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.preset-name-input:focus { border-color: var(--accent); }
.move-grid { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.move-read-row { flex-basis: 100%; display: flex; }
.move-field { display: flex; flex-direction: column; gap: 3px; min-width: 80px; }
.move-field--hidden { visibility: hidden; }
.move-label { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); }
.move-input {
  padding: 6px 8px; font-family: var(--font-mono); font-size: 0.82rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); width: 80px; outline: none; text-align: right;
}
.move-input:focus { border-color: var(--accent); }
.move-unit { font-family: var(--font-body); font-size: 0.62rem; color: var(--text-muted); }
.move-btn { align-self: flex-end; margin-left: auto; }
.move-paste-btn { align-self: center; display: inline-flex; align-items: center; justify-content: center; }
.move-paste-btn svg { display: block; }

/* Preset Management */
.preset-section { border-top: 1px solid var(--border); padding-top: 12px; }
.preset-section-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.preset-section-actions { display: flex; gap: 6px; align-items: center; }
.preset-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
.preset-list::-webkit-scrollbar { width: 4px; }
.preset-list::-webkit-scrollbar-track { background: transparent; }
.preset-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.preset-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; border-radius: var(--radius);
  border: 1px solid transparent; transition: all var(--duration-fast);
}
.preset-item:not(.preset-item--system):hover { border-color: var(--border); background: var(--surface-1); }
.preset-item--selected { border-color: var(--cyan-600); background: var(--cyan-900); }
.preset-item--system { opacity: 0.6; cursor: default; }
.preset-item--dragging { opacity: 0.4; }
.preset-item--dragover { border-color: var(--cyan-400); }
.preset-item-grip {
  color: var(--text-muted); cursor: grab; font-size: 14px; letter-spacing: -2px;
  user-select: none; padding: 0 4px; line-height: 1;
}
.preset-item-grip:active { cursor: grabbing; }
.preset-item-info { display: flex; flex-direction: column; min-width: 0; cursor: pointer; flex: 1; }
.preset-item-name { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.preset-item-joints { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preset-item-actions { display: flex; gap: 2px; flex-shrink: 0; }
.btn-icon {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  background: none; border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer;
  font-size: 11px; color: var(--text-muted); transition: all var(--duration-fast);
}
.btn-icon:hover:not(:disabled) { border-color: var(--border); color: var(--text-primary); background: var(--surface-1); }
.btn-icon:disabled { opacity: 0.25; cursor: not-allowed; }
.btn-icon--danger:hover:not(:disabled) { color: var(--status-danger); border-color: var(--status-danger); }
.preset-item-badge {
  font-family: var(--font-body); font-size: 0.62rem; font-weight: 600;
  padding: 1px 7px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted);
}
.preset-empty { text-align: center; padding: 16px; font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-muted); }
.modal-overlay--inline { position: absolute; inset: 0; border-radius: var(--radius-lg); }

/* Modal (for rename preset) */
.modal-overlay { position: fixed; inset: 0; background: rgba(8,9,10,0.72); backdrop-filter: blur(6px); z-index: 200; display: flex; align-items: center; justify-content: center; }
.modal { width: 100%; max-width: 400px; padding: 28px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { margin: 0; font-family: var(--font-display); font-size: 0.95rem; font-weight: 600; color: var(--text-primary); }
.modal-close {
  background: none; border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; color: var(--text-muted); padding: 4px; display: flex;
  transition: all var(--duration-fast);
}
.modal-close:hover { color: var(--text-primary); border-color: var(--border-bright); background: var(--surface-1); }
.modal-form { display: flex; flex-direction: column; }
.modal-actions { display: flex; gap: 12px; }
.modal-actions .btn { flex: 1; }

/* Settings Side Panel */
.settings-panel {
  position: fixed; top: 0; right: 0; width: min(720px, 92vw); height: 100vh;
  z-index: 100; overflow: hidden; display: flex; flex-direction: column;
  border-left: 1px solid var(--border); background: var(--surface-0);
  box-shadow: -8px 0 32px rgba(0,0,0,0.5);
  border-radius: 0;
}
.settings-layout { display: flex; flex: 1; min-height: 0; }
.settings-sidebar {
  width: 132px; flex-shrink: 0; padding: 10px 0;
  border-right: 1px solid var(--border-subtle);
  display: flex; flex-direction: column; gap: 2px;
  overflow-y: auto;
}

.settings-alias-input { padding: 5px 8px; font-family: var(--font-mono); font-size: 0.74rem; background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-primary); outline: none; flex: 1; }
.settings-alias-input:focus { border-color: var(--accent); }
.settings-nav-item {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px;
  background: transparent; border: none; cursor: pointer;
  font-family: var(--font-body); font-size: 0.74rem; font-weight: 500;
  color: var(--text-muted);
  transition: all 0.15s ease; text-align: left; width: 100%;
  border-left: 2px solid transparent;
}
.settings-nav-item:hover { color: var(--text-primary); background: var(--surface-1); }
.settings-nav-item--active {
  color: var(--cyan-300); background: var(--cyan-900);
  border-left-color: var(--cyan-500);
}
.settings-nav-icon { display: inline-flex; align-items: center; flex-shrink: 0; }
.settings-nav-label { white-space: nowrap; }
.settings-content { flex: 1; overflow-y: auto; padding: 12px 16px 20px; min-height: 0; }
.settings-placeholder { display: flex; align-items: center; justify-content: center; height: 200px; }

.settings-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-subtle); }
.settings-section:first-of-type { margin-top: 0; padding-top: 0; border-top: none; }
.settings-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.settings-section-header h4 { margin: 0; font-family: var(--font-display); font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); }

.load-fields { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.load-field { display: flex; flex-direction: column; gap: 3px; }
.load-field label { font-family: var(--font-body); font-size: 0.66rem; font-weight: 500; color: var(--text-muted); }
.input-sm { padding: 5px 8px; font-family: var(--font-mono); font-size: 0.74rem; background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-primary); outline: none; }
.input-sm:focus { border-color: var(--accent); }
.input-sm[readonly] { opacity: 0.55; cursor: default; user-select: none; }
.load-field .input-sm { width: 100%; }

.load-config-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 0.72rem; }
.load-config-table th { text-align: left; padding: 6px 6px; font-family: var(--font-body); font-size: 0.66rem; font-weight: 600; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); }
.load-config-table td { padding: 5px 6px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); vertical-align: middle; }
.load-config-table .preset-name { color: var(--text-primary); font-weight: 600; }
.load-config-table .row--editing td { background: var(--cyan-900); padding: 4px 6px; }
.table-actions { display: flex; gap: 4px; }
.load-config-table td .btn + .btn { margin-left: 0; }
.load-config-table .row--editing td:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.load-config-table .row--editing td:last-child { border-radius: 0 var(--radius) var(--radius) 0; }

.input-xs { padding: 3px 5px; font-family: var(--font-mono); font-size: 0.7rem; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-primary); outline: none; }
.input-xs:focus { border-color: var(--accent); }

.btn-xs { padding: 2px 7px; font-size: 0.66rem; height: 22px; }

.mt-2 { margin-top: 12px; }
.text-muted { color: var(--text-muted); }
.checkbox-xs { display: inline-flex; align-items: center; gap: 3px; font-size: 0.66rem; cursor: pointer; }
.checkbox-xs input { width: 14px; height: 14px; cursor: pointer; accent-color: var(--cyan-500); }

.coord-add-row { display: flex; gap: 6px; align-items: center; padding: 8px 0; flex-wrap: wrap; }
.motion-table { min-width: 460px; }
.motion-cell { display: flex; align-items: center; gap: 6px; }
.motion-input { width: 84px; }
.motion-unit { font-size: 0.62rem; color: var(--text-muted); white-space: nowrap; }

.remote-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.remote-col-title { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
.remote-field { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.remote-field label { width: 92px; flex-shrink: 0; font-size: 0.68rem; color: var(--text-muted); }
.di-group-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.drag-grid { display: flex; flex-direction: column; gap: 6px; max-width: 420px; }
.drag-item { display: flex; align-items: center; gap: 10px; }
.drag-label { width: 24px; font-size: 0.72rem; color: var(--text-muted); flex-shrink: 0; }
.drag-item .speed-slider { flex: 1; }
.drag-value { width: 30px; text-align: right; font-size: 0.72rem; color: var(--text-primary); }

.dobotplus-args-input {
  width: 100%; margin-top: 8px; padding: 6px 8px;
  font-family: var(--font-mono); font-size: 0.72rem; line-height: 1.5;
  color: var(--text-primary); background: var(--void-deep);
  border: 1px solid var(--border); border-radius: var(--radius);
  outline: none; resize: vertical; box-sizing: border-box;
}
.dobotplus-args-input:focus { border-color: var(--accent); }
.dobotplus-result {
  margin-top: 8px; padding: 8px 10px; overflow: auto; max-height: 220px;
  font-family: var(--font-mono); font-size: 0.7rem; line-height: 1.5;
  color: var(--cyan-300); background: var(--void-deep);
  border: 1px solid var(--border-subtle); border-radius: var(--radius);
  white-space: pre-wrap; word-break: break-all;
}

.dobotplus-toolbar { position: relative; }
.dobotplus-iframe {
  width: 100%; height: 560px; border: 1px solid var(--border-subtle);
  border-radius: var(--radius); background: #fff;
}
.dobotplus-file-input { max-width: 260px; }
.dobotplus-file-input::file-selector-button {
  margin-right: 8px; padding: 3px 8px;
  font-family: var(--font-body); font-size: 0.68rem;
  color: var(--text-secondary); background: var(--surface-1);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  cursor: pointer;
}
.dobotplus-dropdown {
  position: absolute; top: 100%; right: 0; z-index: 250;
  min-width: 180px; margin-top: 4px; padding: 4px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
}
.dobotplus-dropdown-item {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 12px;
  background: transparent; border: none; border-radius: var(--radius);
  color: var(--text-secondary); font-family: var(--font-body); font-size: 0.78rem;
  font-weight: 500; cursor: pointer; text-align: left;
}
.dobotplus-dropdown-item:hover { background: var(--surface-1); color: var(--cyan-300); }

/* Trajectory recording */
.track-item { display: inline-flex; align-items: center; gap: 2px; }
.track-item-action {
  border: none; background: transparent; color: var(--text-muted);
  font-size: 0.6rem; padding: 1px 3px; cursor: pointer; line-height: 1;
  border-radius: 3px;
}
.track-item-action:hover { color: var(--text-primary); background: var(--surface-2); }
.recording-indicator {
  color: #ff5252; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.04em;
  animation: traj-blink 1.2s ease-in-out infinite;
}
@keyframes traj-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.track-playback-bar, .track-params-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 10px; margin-bottom: 4px;
  background: var(--surface-2); border-radius: var(--radius-sm);
  font-size: 0.62rem; color: var(--text-secondary);
}
.track-playback-text { flex: 1; font-family: var(--font-mono); }
.track-param { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); }
.track-param--check { cursor: pointer; }
.traj-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 0.65rem; }
.traj-table th { text-align: left; padding: 4px 6px; font-family: var(--font-display); font-size: 0.48rem; font-weight: 700; letter-spacing: 0.08em; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); position: sticky; top: 0; background: var(--void-surface); }
.traj-table td { padding: 3px 6px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); }
.traj-table .row--moving td { background: #ff174422; color: #ff6b6b; }

.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-family: var(--font-body); font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); }
.btn-quick--sys { border-color: var(--cyan-700); color: var(--cyan-300); background: var(--cyan-900); }

.estop-btn { padding: 12px 28px; font-size: 13px; background: var(--status-danger); border-color: transparent; color: #fff; box-shadow: var(--shadow-md); }
.estop-btn:hover:not(:disabled) { background: #dc2626; border-color: transparent; box-shadow: var(--shadow-lg); }

/* DobotES01 sucker control */
.es01-control {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-0);
}
.es01-control--busy { opacity: 0.7; }
.es01-label {
  font-family: var(--font-body); font-size: 0.72rem; font-weight: 600;
  color: var(--text-muted); white-space: nowrap;
}
.es01-status {
  font-family: var(--font-mono); font-size: 0.68rem; font-weight: 600;
  padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border);
  color: var(--text-muted); min-width: 52px; text-align: center;
}
.es01-status--grip { color: var(--cyan-300); border-color: var(--cyan-500); background: var(--cyan-900); }
.es01-status--release { color: var(--text-secondary); }
.es01-status--alarm { color: var(--status-danger); border-color: var(--status-danger); background: var(--status-danger-dim); }
.es01-status--unknown { color: var(--text-muted); }
.es01-settings-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* Quick Posture Buttons */
.quick-posture-bar { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 0; }
.btn-quick-posture {
  min-width: 36px; height: 28px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--void-deep); color: var(--text-muted);
  cursor: pointer; font-family: var(--font-body); font-size: 0.78rem; font-weight: 600;
  transition: all 0.15s ease;
  display: inline-flex; align-items: center; gap: 4px;
}
.btn-quick-posture:hover:not(:disabled) { border-color: var(--cyan-500); color: var(--cyan-300); background: var(--cyan-900); }
.btn-quick-posture--moving { border-color: var(--status-danger); color: var(--status-danger); background: var(--status-danger-dim); }
.btn-quick-posture--cart { border-color: var(--cyan-700); color: var(--cyan-300); }
.btn-quick-posture .qpi { font-size: 0.78rem; }
.btn-quick-posture .qpi-tag {
  font-family: var(--font-mono); font-size: 0.55rem; font-weight: 700;
  padding: 0 4px; border-radius: 3px;
  background: var(--cyan-900); color: var(--cyan-300); border: 1px solid var(--cyan-700);
}
.preset-type-badge {
  display: inline-block; margin-left: 6px;
  font-family: var(--font-mono); font-size: 0.55rem; font-weight: 700;
  padding: 1px 5px; border-radius: 3px; vertical-align: middle;
  background: var(--cyan-900); color: var(--cyan-300); border: 1px solid var(--cyan-700);
}
.preset-type-badge--joint {
  background: var(--surface-2); color: var(--text-muted); border-color: var(--border);
}
.preset-item--cartesian .preset-item-name { color: var(--cyan-300); }

.preset-rename-input {
  padding: 1px 4px; font-family: var(--font-mono); font-size: 0.7rem;
  background: var(--surface-1); border: 1px solid var(--cyan-500); border-radius: var(--radius);
  color: var(--text-primary); outline: none; width: 80px;
}

/* Alarm Panel */
.alarm-panel { border: 1px solid var(--status-danger); }
.alarm-panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.alarm-actions { display: flex; gap: 6px; }
.alarm-list { display: flex; flex-direction: column; gap: 6px; }
.alarm-item { display: flex; flex-direction: column; gap: 6px; padding: 9px 12px; border-radius: var(--radius); font-family: var(--font-mono); font-size: 0.7rem; }
.alarm-item--error { background: var(--status-danger-dim); border: 1px solid var(--status-danger); color: var(--status-danger); }
.alarm-item--warn { background: var(--status-warning-dim); border: 1px solid var(--status-warning); color: var(--status-warning); }
.alarm-item-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.alarm-icon { display: inline-flex; align-items: center; flex-shrink: 0; }
.alarm-code { font-weight: 700; font-family: var(--font-mono); font-size: 0.66rem; }
.alarm-level { padding: 2px 6px; border: 1px solid currentColor; border-radius: var(--radius-sm); font-size: 0.6rem; opacity: 0.9; }
.alarm-time { color: var(--text-muted); font-size: 0.6rem; }
.alarm-detail { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding-left: 22px; }
.alarm-msg { color: var(--text-primary); line-height: 1.35; overflow-wrap: anywhere; }
.alarm-solution { color: var(--text-muted); line-height: 1.35; overflow-wrap: anywhere; }

/* Warning button variant */
.btn-warning { background: var(--surface-1); border-color: var(--status-warning); color: var(--status-warning); }
.btn-warning:hover:not(:disabled) { background: var(--status-warning-dim); }

/* Side panel backdrop — click outside to close */
.side-panel-overlay {
  position: fixed; inset: 0; z-index: 99;
  background: rgba(8, 9, 10, 0.45);
  backdrop-filter: blur(2px);
}

/* Device Log Panel */
.log-panel {
  position: fixed; top: 0; right: 0; width: 420px; max-width: 90vw; height: 100vh;
  z-index: 100; overflow: hidden; display: flex; flex-direction: column;
  border-left: 1px solid var(--border); background: var(--surface-0);
  box-shadow: -8px 0 32px rgba(0,0,0,0.5);
}
.log-panel-header {
  display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
  padding: 14px 18px 10px; border-bottom: 1px solid var(--border);
}
.log-panel-title { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.log-tabs { display: flex; gap: 2px; }
.log-tab {
  padding: 4px 10px; border: 1px solid var(--border); background: var(--void-deep);
  color: var(--text-muted); cursor: pointer; font-family: var(--font-body);
  font-size: 0.68rem; font-weight: 500;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}
.log-tab:hover:not(.log-tab--active) { background: var(--surface-1); color: var(--text-primary); }
.log-tab:active { transform: translateY(1px); }
.log-tab:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.log-tab:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.log-tab--active { border-color: var(--cyan-500); background: var(--cyan-900); color: var(--cyan-300); }
.log-panel-actions { display: flex; align-items: center; gap: 8px; }
.log-count { font-family: var(--font-mono); font-size: 0.66rem; color: var(--text-muted); }
.history-log-controls { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.history-date-row, .history-type-row { display: flex; gap: 6px; flex-wrap: wrap; }
.history-input {
  flex: 1; min-width: 0; padding: 6px 8px; font-family: var(--font-mono); font-size: 0.7rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.history-input:focus { border-color: var(--accent); }
.history-input--wide { width: 100%; flex: none; }
.history-type-chip { display: flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.history-type-chip input { accent-color: var(--cyan-500); }
.history-type-chip span { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); }
.history-file-summary {
  font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.log-list { flex: 1; overflow-y: auto; padding: 8px 12px; }
.log-list::-webkit-scrollbar { width: 4px; }
.log-list::-webkit-scrollbar-track { background: transparent; }
.log-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.log-empty { font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-muted); text-align: center; padding: 40px 0; }
.log-entry { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: var(--radius); transition: background var(--duration-fast); }
.log-entry:hover { background: var(--surface-1); }
.log-entry--alarm { background: var(--status-danger-dim); border: 1px solid var(--status-danger); margin-bottom: 4px; }
.log-entry--warning { background: var(--status-warning-dim); border: 1px solid var(--status-warning); margin-bottom: 4px; }
.log-entry--error { background: var(--status-danger-dim); border: 1px solid var(--status-danger); margin-bottom: 4px; }
.log-entry--info { background: var(--status-info-dim); border: 1px solid var(--cyan-700); margin-bottom: 4px; }
.log-entry--user { background: var(--status-online-dim); border: 1px solid var(--status-online); margin-bottom: 4px; }
.log-entry--plain { background: var(--surface-1); border: 1px solid var(--border); margin-bottom: 4px; }
.log-time { font-family: var(--font-mono); font-size: 0.56rem; color: var(--text-muted); flex-shrink: 0; min-width: 70px; white-space: nowrap; }
.log-icon { flex-shrink: 0; width: 16px; display: inline-flex; justify-content: center; align-items: center; }
.log-entry--alarm .log-icon { color: var(--status-danger); }
.log-entry--warning .log-icon { color: var(--status-warning); }
.log-entry--error .log-icon { color: var(--status-danger); }
.log-entry--info .log-icon { color: var(--cyan-300); }
.log-entry--user .log-icon { color: var(--status-online); }
.log-entry--plain .log-icon { color: var(--text-muted); }
.log-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.log-title { font-family: var(--font-body); font-size: 0.72rem; font-weight: 600; }
.log-entry--alarm .log-title { color: var(--status-danger); }
.log-entry--warning .log-title { color: var(--status-warning); }
.log-entry--error .log-title { color: var(--status-danger); }
.log-entry--info .log-title { color: var(--cyan-300); }
.log-entry--user .log-title { color: var(--status-online); }
.log-entry--plain .log-title { color: var(--text-muted); }
.log-level { font-family: var(--font-mono); font-size: 0.56rem; color: var(--text-muted); }
.log-desc { font-size: 0.66rem; color: var(--text-primary); line-height: 1.3; }
.log-solution { font-size: 0.6rem; color: var(--text-muted); line-height: 1.3; padding-top: 2px; }
.history-log-list { padding-top: 10px; }
.history-log-entry .log-time { min-width: 92px; overflow: hidden; text-overflow: ellipsis; }
.history-log-text {
  font-family: var(--font-mono); font-size: 0.64rem; color: var(--text-primary);
  line-height: 1.35; overflow-wrap: anywhere; white-space: pre-wrap;
}

.status-dot--warning { background: var(--status-warning); }

.logs-slide-enter-active { transition: transform 0.25s var(--ease-out); }
.logs-slide-leave-active { transition: transform 0.2s var(--ease-in); }
.logs-slide-enter-from, .logs-slide-leave-to { transform: translateX(100%); }

/* Fade transition for settings modal */
.fade-enter-active { transition: opacity 0.2s ease-out; }
.fade-leave-active { transition: opacity 0.15s ease-in; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
