<script setup>
import { onMounted } from 'vue';
import { useBugReport } from 'bugbottle/vue';

const report = useBugReport({ endpoint: '/reports' });
const { message, contact, isSending, statusMessage } = report;
onMounted(() => report.open());
// The smoke retains this instance to check that scope disposal stops updates.
window.probeDisposed = () => {
  const before = message.value;
  report.setMessage('Disposed instance');
  return message.value === before;
};
</script>

<template>
  <form data-bugbottle @submit.prevent="report.submit()">
    <label>Message <textarea v-model="message" required /></label>
    <label>Contact <input name="contact" v-model="contact" /></label>
    <p role="status">{{ statusMessage }}</p>
    <button type="submit" :disabled="isSending">Send</button>
  </form>
</template>
