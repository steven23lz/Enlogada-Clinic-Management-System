import { Button } from '../ui/button';

/**
 * The patient already has this test today: is it a repeat? [1.157.0]
 *
 * The server's own sentence names the test. A repeat can be genuine, so the desk may say yes, and that
 * yes goes on the Activity Log under their name; "Go back" keeps what they had chosen, to change it.
 *
 * @param {{ message: string, loading?: boolean, onConfirm: () => void, onBack: () => void }} props
 */
const RepeatTestPrompt = ({ message, loading = false, onConfirm, onBack }) => (
  <div data-testid="repeat-test-prompt" role="alert" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
    <p className="m-0 text-note font-semibold leading-relaxed text-amber-900">{message}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" loading={loading} onClick={onConfirm}>
        Yes, it is a repeat
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onBack}>
        Go back
      </Button>
    </div>
  </div>
);

export default RepeatTestPrompt;
