const MENU_LABELS = Object.freeze([
  "叫“爸爸”",
  "说“我错了”",
  "原地休息/恢复活动",
  "挑战螃蟹",
  "自动约战",
  "自主活动",
  "桌宠大小",
  "语音音量",
  "开机启动",
  "设置",
  "退出"
]);

const MENU_ACTIONS = Object.freeze([
  "speak-father",
  "speak-apology",
  "toggle-rest",
  "toggle-autonomous",
  "set-scale",
  "set-volume",
  "toggle-autostart",
  "open-settings",
  "quit"
]);

function isMenuAction(action) {
  return MENU_ACTIONS.includes(action);
}

function action(onAction, action, value) {
  return () => {
    if (isMenuAction(action)) onAction(action, value);
  };
}

function createMenuTemplate({ settings, resting = false, onAction }) {
  if (!settings || typeof onAction !== "function") throw new TypeError("menu settings and action handler are required");
  const scaleValues = [1, 1.25, 1.5, 1.75, 2];
  const volumeValues = [0, 25, 50, 75, 100];
  return [
    { label: MENU_LABELS[0], click: action(onAction, "speak-father") },
    { label: MENU_LABELS[1], click: action(onAction, "speak-apology") },
    { label: MENU_LABELS[2], type: "checkbox", checked: resting, click: action(onAction, "toggle-rest") },
    { label: MENU_LABELS[3], enabled: false },
    { label: MENU_LABELS[4], type: "checkbox", checked: settings.autoDuel, enabled: false },
    { label: MENU_LABELS[5], type: "checkbox", checked: settings.autonomousActivity, click: action(onAction, "toggle-autonomous") },
    {
      label: MENU_LABELS[6],
      submenu: scaleValues.map(value => ({
        label: `${Math.round(value * 100)}%`,
        type: "radio",
        checked: settings.petScale === value,
        click: action(onAction, "set-scale", value)
      }))
    },
    {
      label: MENU_LABELS[7],
      submenu: volumeValues.map(value => ({
        label: `${value}%`,
        type: "radio",
        checked: settings.speechVolume === value,
        click: action(onAction, "set-volume", value)
      }))
    },
    { label: MENU_LABELS[8], type: "checkbox", checked: settings.launchAtLogin, click: action(onAction, "toggle-autostart") },
    { label: MENU_LABELS[9], click: action(onAction, "open-settings") },
    { label: MENU_LABELS[10], click: action(onAction, "quit") }
  ];
}

module.exports = { MENU_ACTIONS, MENU_LABELS, createMenuTemplate, isMenuAction };
