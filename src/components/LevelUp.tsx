import { CHARACTER_NAME, LEVELS } from '../lib/character';
import { useChara, useStore } from '../store';
import { Dialog } from './Dialog';
import { CharacterFace } from './Character';

/** 進化の瞬間：段階が上がったときに一度だけ出すお祝い */
export function LevelUpDialog() {
  const { state, actions } = useStore();
  const chara = useChara();
  const lv = state.levelUp;
  const L = lv ? LEVELS[lv - 1] : null;
  const next = lv ? LEVELS[lv] : undefined;
  return (
    <Dialog open={!!L} onClose={actions.clearLevelUp} title={L ? `レベルアップ！ Lv.${L.level} ${L.name}` : ''}>
      {L && (
        <div className="levelup">
          <div className="levelup-stage" aria-hidden="true">
            <span className="burst b1" />
            <span className="burst b2" />
            <span className="burst b3" />
            <span className="burst b4" />
            <CharacterFace mood="happy" level={L.level} color={chara.color} accessory={chara.accessory} size={200} decorative />
          </div>
          <p className="levelup-desc">{L.desc}</p>
          <p className="levelup-fact">
            {CHARACTER_NAME}が進化しました。つづけた日 <strong className="num">{chara.growth.days}日</strong>
          </p>
          {next && <p className="help">次は Lv.{next.level} {next.name}（つづけた日 {next.days}日）</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={actions.clearLevelUp} data-autofocus>
              やったね！
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
