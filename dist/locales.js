/**
 * Every string a reporter can see, in one shape, in several languages.
 *
 * `messages` are the status lines the hook and `bugbottle/ui` show after
 * something happens. `ui` are the labels the optional widget renders. Both are
 * plain objects: spread one and override what you like, or write your own
 * from scratch — the types tell you what is required.
 *
 *     import { da } from "bugbottle/locales";
 *     useBugReport({ endpoint, messages: da.messages });
 *     mountBugbottle({ endpoint, locale: { ...da, ui: { ...da.ui, title: "Hjælp os" } } });
 */
/**
 * The English status messages on their own, so the React hook can fall back
 * to them without carrying the widget labels of every locale in its bundle.
 */
export const enMessages = {
    empty: "Write a message first",
    screenshotTooLarge: "The picture is too large — sending without it",
    screenshotFailed: "The picture could not be taken — you can still send without it",
    sendFailed: "The report could not be sent",
    sent: "Thank you — the report is on its way",
    queued: "Saved — it will be sent when you are back online",
};
export const en = {
    code: "en",
    messages: enMessages,
    ui: {
        trigger: "Feedback",
        title: "Report a problem",
        intro: "Tell us what went wrong, or what you would like to see.",
        types: { bug: "Bug", idea: "Idea", other: "Other" },
        messageLabel: "What happened?",
        messagePlaceholder: "What is wrong, missing or confusing?",
        screenshot: "Attach a picture of this page",
        screenshotNote: "The picture shows this page as you see it now.",
        pickElement: "Point at the element",
        picking: "Click anything to attach it — Esc to stop",
        attached: "Attached",
        remove: "Remove",
        send: "Send",
        sending: "Sending…",
        close: "Close",
        thanks: "Thank you. We have received your report.",
    },
    email: {
        subject: "New report: {title}",
        intro: "A new report arrived from your application. The details are below.",
    },
};
export const da = {
    code: "da",
    messages: {
        empty: "Skriv en besked først",
        screenshotTooLarge: "Billedet er for stort — sender uden det",
        screenshotFailed: "Billedet kunne ikke tages — du kan stadig sende uden",
        sendFailed: "Rapporten kunne ikke sendes",
        sent: "Tak — rapporten er på vej",
        queued: "Gemt — den bliver sendt, når du er online igen",
    },
    ui: {
        trigger: "Feedback",
        title: "Meld et problem",
        intro: "Fortæl os hvad der gik galt, eller hvad du savner.",
        types: { bug: "Fejl", idea: "Idé", other: "Andet" },
        messageLabel: "Hvad skete der?",
        messagePlaceholder: "Hvad er galt, mangler eller er forvirrende?",
        screenshot: "Vedhæft et billede af denne side",
        screenshotNote: "Billedet viser siden som du ser den nu.",
        pickElement: "Peg på elementet",
        picking: "Klik på det, der skal vedhæftes — Esc for at stoppe",
        attached: "Vedhæftet",
        remove: "Fjern",
        send: "Send",
        sending: "Sender…",
        close: "Luk",
        thanks: "Tak. Vi har modtaget din rapport.",
    },
    email: {
        subject: "Ny rapport: {title}",
        intro: "Der er kommet en ny rapport fra din applikation. Detaljerne står nedenfor.",
    },
};
export const sv = {
    code: "sv",
    messages: {
        empty: "Skriv ett meddelande först",
        screenshotTooLarge: "Bilden är för stor — skickar utan den",
        screenshotFailed: "Bilden kunde inte tas — du kan ändå skicka utan",
        sendFailed: "Rapporten kunde inte skickas",
        sent: "Tack — rapporten är på väg",
        queued: "Sparad — den skickas när du är online igen",
    },
    ui: {
        trigger: "Feedback",
        title: "Rapportera ett problem",
        intro: "Berätta vad som gick fel, eller vad du saknar.",
        types: { bug: "Fel", idea: "Idé", other: "Annat" },
        messageLabel: "Vad hände?",
        messagePlaceholder: "Vad är fel, saknas eller är förvirrande?",
        screenshot: "Bifoga en bild av den här sidan",
        screenshotNote: "Bilden visar sidan som du ser den nu.",
        pickElement: "Peka på elementet",
        picking: "Klicka på det som ska bifogas — Esc för att avbryta",
        attached: "Bifogat",
        remove: "Ta bort",
        send: "Skicka",
        sending: "Skickar…",
        close: "Stäng",
        thanks: "Tack. Vi har tagit emot din rapport.",
    },
    email: {
        subject: "Ny rapport: {title}",
        intro: "En ny rapport har kommit från din applikation. Detaljerna står nedan.",
    },
};
export const nb = {
    code: "nb",
    messages: {
        empty: "Skriv en melding først",
        screenshotTooLarge: "Bildet er for stort — sender uten det",
        screenshotFailed: "Bildet kunne ikke tas — du kan fortsatt sende uten",
        sendFailed: "Rapporten kunne ikke sendes",
        sent: "Takk — rapporten er på vei",
        queued: "Lagret — den blir sendt når du er tilkoblet igjen",
    },
    ui: {
        trigger: "Tilbakemelding",
        title: "Meld et problem",
        intro: "Fortell oss hva som gikk galt, eller hva du savner.",
        types: { bug: "Feil", idea: "Idé", other: "Annet" },
        messageLabel: "Hva skjedde?",
        messagePlaceholder: "Hva er galt, mangler eller er forvirrende?",
        screenshot: "Legg ved et bilde av denne siden",
        screenshotNote: "Bildet viser siden slik du ser den nå.",
        pickElement: "Pek på elementet",
        picking: "Klikk på det som skal legges ved — Esc for å avbryte",
        attached: "Vedlagt",
        remove: "Fjern",
        send: "Send",
        sending: "Sender…",
        close: "Lukk",
        thanks: "Takk. Vi har mottatt rapporten din.",
    },
    email: {
        subject: "Ny rapport: {title}",
        intro: "Det har kommet en ny rapport fra applikasjonen din. Detaljene står nedenfor.",
    },
};
export const de = {
    code: "de",
    messages: {
        empty: "Bitte zuerst eine Nachricht schreiben",
        screenshotTooLarge: "Das Bild ist zu groß — wird ohne Bild gesendet",
        screenshotFailed: "Das Bild konnte nicht aufgenommen werden — Senden ohne Bild ist möglich",
        sendFailed: "Die Meldung konnte nicht gesendet werden",
        sent: "Danke — die Meldung ist unterwegs",
        queued: "Gespeichert — sie wird gesendet, sobald Sie wieder online sind",
    },
    ui: {
        trigger: "Feedback",
        title: "Problem melden",
        intro: "Sagen Sie uns, was schiefging oder was Ihnen fehlt.",
        types: { bug: "Fehler", idea: "Idee", other: "Sonstiges" },
        messageLabel: "Was ist passiert?",
        messagePlaceholder: "Was ist falsch, fehlt oder ist verwirrend?",
        screenshot: "Bild dieser Seite anhängen",
        screenshotNote: "Das Bild zeigt diese Seite so, wie Sie sie jetzt sehen.",
        pickElement: "Auf das Element zeigen",
        picking: "Klicken Sie auf das Element — Esc zum Abbrechen",
        attached: "Angehängt",
        remove: "Entfernen",
        send: "Senden",
        sending: "Wird gesendet…",
        close: "Schließen",
        thanks: "Danke. Wir haben Ihre Meldung erhalten.",
    },
    email: {
        subject: "Neue Meldung: {title}",
        intro: "Aus Ihrer Anwendung ist eine neue Meldung eingegangen. Die Einzelheiten stehen unten.",
    },
};
export const nl = {
    code: "nl",
    messages: {
        empty: "Schrijf eerst een bericht",
        screenshotTooLarge: "De afbeelding is te groot — wordt zonder verzonden",
        screenshotFailed: "De afbeelding kon niet worden gemaakt — je kunt zonder verzenden",
        sendFailed: "De melding kon niet worden verzonden",
        sent: "Bedankt — de melding is onderweg",
        queued: "Opgeslagen — de melding wordt verzonden zodra u weer online bent",
    },
    ui: {
        trigger: "Feedback",
        title: "Probleem melden",
        intro: "Vertel ons wat er misging, of wat je mist.",
        types: { bug: "Fout", idea: "Idee", other: "Anders" },
        messageLabel: "Wat gebeurde er?",
        messagePlaceholder: "Wat is er mis, ontbreekt of is verwarrend?",
        screenshot: "Een afbeelding van deze pagina bijvoegen",
        screenshotNote: "De afbeelding toont deze pagina zoals je die nu ziet.",
        pickElement: "Wijs het element aan",
        picking: "Klik op wat je wilt bijvoegen — Esc om te stoppen",
        attached: "Bijgevoegd",
        remove: "Verwijderen",
        send: "Verzenden",
        sending: "Verzenden…",
        close: "Sluiten",
        thanks: "Bedankt. We hebben je melding ontvangen.",
    },
    email: {
        subject: "Nieuwe melding: {title}",
        intro: "Er is een nieuwe melding uit je applicatie binnengekomen. De details staan hieronder.",
    },
};
export const fr = {
    code: "fr",
    messages: {
        empty: "Écrivez d'abord un message",
        screenshotTooLarge: "L'image est trop grande — envoi sans image",
        screenshotFailed: "L'image n'a pas pu être prise — vous pouvez envoyer sans",
        sendFailed: "Le signalement n'a pas pu être envoyé",
        sent: "Merci — le signalement est en route",
        queued: "Enregistré — il sera envoyé dès votre retour en ligne",
    },
    ui: {
        trigger: "Commentaires",
        title: "Signaler un problème",
        intro: "Dites-nous ce qui n'a pas fonctionné, ou ce qui vous manque.",
        types: { bug: "Bug", idea: "Idée", other: "Autre" },
        messageLabel: "Que s'est-il passé ?",
        messagePlaceholder: "Qu'est-ce qui est faux, manquant ou déroutant ?",
        screenshot: "Joindre une image de cette page",
        screenshotNote: "L'image montre cette page telle que vous la voyez.",
        pickElement: "Désigner l'élément",
        picking: "Cliquez sur l'élément à joindre — Échap pour arrêter",
        attached: "Joint",
        remove: "Retirer",
        send: "Envoyer",
        sending: "Envoi…",
        close: "Fermer",
        thanks: "Merci. Nous avons bien reçu votre signalement.",
    },
    email: {
        subject: "Nouveau signalement : {title}",
        intro: "Un nouveau signalement est arrivé depuis votre application. Les détails sont ci-dessous.",
    },
};
export const es = {
    code: "es",
    messages: {
        empty: "Escribe un mensaje primero",
        screenshotTooLarge: "La imagen es demasiado grande — se envía sin ella",
        screenshotFailed: "No se pudo tomar la imagen — puedes enviar sin ella",
        sendFailed: "No se pudo enviar el informe",
        sent: "Gracias — el informe está en camino",
        queued: "Guardado — se enviará cuando vuelvas a estar en línea",
    },
    ui: {
        trigger: "Comentarios",
        title: "Informar de un problema",
        intro: "Cuéntanos qué salió mal o qué echas en falta.",
        types: { bug: "Error", idea: "Idea", other: "Otro" },
        messageLabel: "¿Qué ha pasado?",
        messagePlaceholder: "¿Qué está mal, falta o resulta confuso?",
        screenshot: "Adjuntar una imagen de esta página",
        screenshotNote: "La imagen muestra esta página tal como la ves ahora.",
        pickElement: "Señalar el elemento",
        picking: "Haz clic en lo que quieras adjuntar — Esc para cancelar",
        attached: "Adjunto",
        remove: "Quitar",
        send: "Enviar",
        sending: "Enviando…",
        close: "Cerrar",
        thanks: "Gracias. Hemos recibido tu informe.",
    },
    email: {
        subject: "Nuevo informe: {title}",
        intro: "Ha llegado un nuevo informe desde tu aplicación. Los detalles están abajo.",
    },
};
/** Every bundled locale, keyed by code. */
export const locales = { en, da, sv, nb, de, nl, fr, es };
/**
 * Picks a bundled locale for a language tag — `"da-DK"` gives Danish,
 * `"pt-BR"` falls back to English. Pass `navigator.language` to follow the
 * browser.
 */
export function resolveLocale(tag, fallback = en) {
    if (!tag)
        return fallback;
    const lower = tag.toLowerCase();
    return locales[lower] ?? locales[lower.split("-")[0] ?? ""] ?? fallback;
}
//# sourceMappingURL=locales.js.map