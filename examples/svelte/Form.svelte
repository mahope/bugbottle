<script>
  import { onMount, onDestroy } from 'svelte';
  import { createBugReport } from 'bugbottle/svelte';

  const form = createBugReport({ endpoint: '/reports' });
  // Observe the real compiler-created $form subscription, including teardown.
  const subscribe = form.subscribe;
  let active = 0;
  form.subscribe = run => {
    active++;
    const stop = subscribe(run);
    return () => { active--; stop(); };
  };
  window.probeDisposed = () => active === 0;
  onMount(() => form.open());
  onDestroy(() => form.destroy());
</script>

<form data-bugbottle on:submit|preventDefault={() => form.submit()}>
  <label>Message <textarea required value={$form.message} on:input={e => form.setMessage(e.currentTarget.value)} /></label>
  <label>Contact <input name="contact" value={$form.contact} on:input={e => form.setContact(e.currentTarget.value)} /></label>
  <p role="status">{$form.statusMessage}</p>
  <button type="submit" disabled={$form.isSending}>Send</button>
</form>
