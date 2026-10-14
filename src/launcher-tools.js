// Profile, backup, updates and Signal on the start screen, next to the choice of
// branch. Each script prepends its button to the toolbar, so this order shows
// «Профіль», «Резервна копія», «Оновлення», «Signal»; the last prepending import («3D-довідники») ends up
// first. «Lite-версія» (lite-export.js) навпаки дописує свою кнопку в кінець рядка.
import './launcher-tools.css';
import './signal-settings.js';
import './backup.js';
import './local-profiles.js';
import './phone-export.js';
import './guides-launcher.js';
import './lite-export.js';
