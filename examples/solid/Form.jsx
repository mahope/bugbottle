import { onCleanup } from 'solid-js';
import { createBugReport } from 'bugbottle/solid';

export default function Form() {
  let release;
  let reject;
  let pending;
  const report = createBugReport({ endpoint: '/reports', timeoutMs: 5_000,
    beforeSend: payload => new Promise((resolve, no) => {
      release = () => resolve(payload);
      reject = () => no(new Error('Synthetic send failure'));
    }),
  });
  report.open();
  window.releaseSubmission = () => release();
  window.rejectSubmission = () => reject();
  onCleanup(() => {
    const before = [report.message(), report.contact(), report.status()];
    window.finishDisposed = async () => {
      release?.();
      await pending;
      report.setMessage('Disposed instance');
      report.setContact('disposed@example.invalid');
      return report.message() === before[0] && report.contact() === before[1] && report.status() === before[2];
    };
  });
  return <form data-bugbottle data-state={report.status().kind} onSubmit={event => {
    event.preventDefault();
    pending = report.submit();
  }}>
    <label>Message <textarea value={report.message()} onInput={event => report.setMessage(event.currentTarget.value)} /></label>
    <label>Contact <input name="contact" value={report.contact()} onInput={event => report.setContact(event.currentTarget.value)} /></label>
    <output id="message-value">{report.message()}</output>
    <output id="contact-value">{report.contact()}</output>
    <p role="status">{report.statusMessage()}</p>
    <button type="submit" disabled={report.isSending()}>Send</button>
  </form>;
}
