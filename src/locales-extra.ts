/**
 * Five more languages in the same `Locale` shape, in their own entry point.
 *
 * `bugbottle/locales` is data, and data is carried whole: every bundle that
 * imports it pays for every language in it. Italy, Poland, Portugal, Finland
 * and Ukraine should not cost a Danish site anything, so they live here and are
 * imported on purpose. Merge them into the bundled map and `resolveLocale`
 * reads both:
 *
 *     import { en, locales, resolveLocale } from "bugbottle/locales";
 *     import { localesExtra } from "bugbottle/locales-extra";
 *
 *     const all = { ...locales, ...localesExtra };
 *     mountBugbottle({ endpoint, locale: resolveLocale(navigator.language, en, all) });
 *
 * Or import the one language the site is in — `import { pl }` — and nothing
 * else reaches the bundle.
 *
 * `pt` is European Portuguese. `pt-BR` resolves to it, because a Brazilian
 * reporter is better served by Portuguese than by the English fallback; the
 * two differ in this text mainly in the progressive ("a enviar" against
 * "enviando") and in where a pronoun sits.
 */

import type { Locale } from "./locales.ts";

export const it: Locale = {
  code: "it",
  messages: {
    empty: "Scrivi prima un messaggio",
    screenshotTooLarge: "L'immagine è troppo grande — invio senza",
    screenshotFailed: "Non è stato possibile creare l'immagine — puoi inviare lo stesso senza",
    sendFailed: "Non è stato possibile inviare la segnalazione",
    sent: "Grazie — la segnalazione è in viaggio",
    queued: "Salvata — verrà inviata quando tornerai online",
  },
  ui: {
    trigger: "Feedback",
    title: "Segnala un problema",
    intro: "Raccontaci cosa non ha funzionato, o cosa ti manca.",
    typeLabel: "Tipo di segnalazione",
    types: { bug: "Errore", idea: "Idea", other: "Altro" },
    messageLabel: "Cosa è successo?",
    messagePlaceholder: "Cosa è sbagliato, manca o non è chiaro?",
    contactLabel: "Come possiamo contattarti?",
    contactHint: "Usato solo per rispondere a questa segnalazione.",
    contactRequired: "Indica come possiamo contattarti",
    screenshot: "Allega un'immagine di questa pagina",
    screenshotNote: "L'immagine mostra questa pagina come la vedi ora.",
    annotate: "Modifica l'immagine",
    annotateArea:
      "Area di disegno. Trascina per contrassegnare l'immagine con lo strumento scelto. Backspace annulla, Esc interrompe il segno che stai tracciando e, quando non stai disegnando, esce dall'editor senza conservare i segni.",
    toolLabel: "Strumento di disegno",
    toolRect: "Rettangolo",
    toolArrow: "Freccia",
    toolBlur: "Sfocatura",
    undo: "Annulla",
    done: "Fatto",
    pickElement: "Indica l'elemento",
    picking: "Fai clic su ciò che vuoi allegare — Esc per interrompere",
    pickingAnnounce:
      "Modalità di selezione. Fai clic su un elemento della pagina per allegarlo, oppure premi Esc per interrompere.",
    pickingDone: "Modalità di selezione terminata.",
    attached: "Allegato",
    remove: "Rimuovi",
    removeElement: "Rimuovi {element}",
    send: "Invia",
    sending: "Invio…",
    close: "Chiudi",
    closeDialog: "Chiudi il pannello di segnalazione",
    thanks: "Grazie. Abbiamo ricevuto la tua segnalazione.",
    openedByError: "Qualcosa è andato storto in questa pagina. Vuoi dirci cosa stavi facendo?",
  },
  email: {
    subject: "Nuova segnalazione: {title}",
    intro: "È arrivata una nuova segnalazione dalla tua applicazione. I dettagli sono qui sotto.",
  },
};

export const pl: Locale = {
  code: "pl",
  messages: {
    empty: "Najpierw napisz wiadomość",
    screenshotTooLarge: "Obraz jest za duży — wysyłamy bez niego",
    screenshotFailed: "Nie udało się zrobić zrzutu — możesz wysłać bez niego",
    sendFailed: "Nie udało się wysłać zgłoszenia",
    sent: "Dziękujemy — zgłoszenie jest w drodze",
    queued: "Zapisano — wyślemy je, gdy wrócisz do sieci",
  },
  ui: {
    trigger: "Opinie",
    title: "Zgłoś problem",
    intro: "Napisz nam, co poszło nie tak albo czego brakuje.",
    typeLabel: "Rodzaj zgłoszenia",
    types: { bug: "Błąd", idea: "Pomysł", other: "Inne" },
    messageLabel: "Co się stało?",
    messagePlaceholder: "Co jest nie tak, czego brakuje lub co jest mylące?",
    contactLabel: "Jak możemy się z Tobą skontaktować?",
    contactHint: "Używamy tego tylko do odpowiedzi na to zgłoszenie.",
    contactRequired: "Napisz, jak możemy się z Tobą skontaktować",
    screenshot: "Dołącz obraz tej strony",
    screenshotNote: "Obraz pokazuje tę stronę tak, jak widzisz ją teraz.",
    annotate: "Edytuj obraz",
    annotateArea:
      "Obszar rysowania. Przeciągnij, aby zaznaczyć obraz wybranym narzędziem. Backspace cofa, Esc przerywa zaznaczenie, które właśnie rysujesz, a gdy nic nie rysujesz — zamyka edytor bez zachowania zaznaczeń.",
    toolLabel: "Narzędzie do rysowania",
    toolRect: "Prostokąt",
    toolArrow: "Strzałka",
    toolBlur: "Rozmycie",
    undo: "Cofnij",
    done: "Gotowe",
    pickElement: "Wskaż element",
    picking: "Kliknij to, co chcesz dołączyć — Esc, aby przerwać",
    pickingAnnounce:
      "Tryb wskazywania. Kliknij element na stronie, aby go dołączyć, albo naciśnij Esc, aby przerwać.",
    pickingDone: "Tryb wskazywania zakończony.",
    attached: "Dołączono",
    remove: "Usuń",
    removeElement: "Usuń {element}",
    send: "Wyślij",
    sending: "Wysyłanie…",
    close: "Zamknij",
    closeDialog: "Zamknij panel zgłoszenia",
    thanks: "Dziękujemy. Otrzymaliśmy Twoje zgłoszenie.",
    openedByError: "Coś poszło nie tak na tej stronie. Chcesz nam napisać, co się wtedy działo?",
  },
  email: {
    subject: "Nowe zgłoszenie: {title}",
    intro: "Z Twojej aplikacji przyszło nowe zgłoszenie. Szczegóły znajdują się poniżej.",
  },
};

export const pt: Locale = {
  code: "pt",
  messages: {
    empty: "Escreva primeiro uma mensagem",
    screenshotTooLarge: "A imagem é demasiado grande — a enviar sem ela",
    screenshotFailed: "Não foi possível capturar a imagem — pode enviar sem ela",
    sendFailed: "Não foi possível enviar o relatório",
    sent: "Obrigado — o relatório está a caminho",
    queued: "Guardado — será enviado quando voltar a estar online",
  },
  ui: {
    trigger: "Comentários",
    title: "Comunicar um problema",
    intro: "Diga-nos o que correu mal, ou o que gostaria de ver.",
    typeLabel: "Tipo de relatório",
    types: { bug: "Erro", idea: "Ideia", other: "Outro" },
    messageLabel: "O que aconteceu?",
    messagePlaceholder: "O que está errado, em falta ou confuso?",
    contactLabel: "Como podemos contactá-lo?",
    contactHint: "Usado apenas para responder a este relatório.",
    contactRequired: "Diga como podemos contactá-lo",
    screenshot: "Anexar uma imagem desta página",
    screenshotNote: "A imagem mostra esta página tal como a vê agora.",
    annotate: "Editar a imagem",
    annotateArea:
      "Área de desenho. Arraste para marcar a imagem com a ferramenta escolhida. Backspace anula, Esc cancela a marca que está a fazer e, quando não está a desenhar, sai do editor sem guardar as marcas.",
    toolLabel: "Ferramenta de desenho",
    toolRect: "Retângulo",
    toolArrow: "Seta",
    toolBlur: "Desfocar",
    undo: "Anular",
    done: "Concluído",
    pickElement: "Apontar para o elemento",
    picking: "Clique no que quiser anexar — Esc para parar",
    pickingAnnounce:
      "Modo de seleção. Clique num elemento da página para o anexar, ou prima Esc para parar.",
    pickingDone: "Modo de seleção terminado.",
    attached: "Anexado",
    remove: "Remover",
    removeElement: "Remover {element}",
    send: "Enviar",
    sending: "A enviar…",
    close: "Fechar",
    closeDialog: "Fechar o painel de relatório",
    thanks: "Obrigado. Recebemos o seu relatório.",
    openedByError: "Algo correu mal nesta página. Quer contar-nos o que estava a fazer?",
  },
  email: {
    subject: "Novo relatório: {title}",
    intro: "Chegou um novo relatório da sua aplicação. Os detalhes estão abaixo.",
  },
};

export const fi: Locale = {
  code: "fi",
  messages: {
    empty: "Kirjoita ensin viesti",
    screenshotTooLarge: "Kuva on liian suuri — lähetetään ilman sitä",
    screenshotFailed: "Kuvaa ei voitu ottaa — voit lähettää silti ilman sitä",
    sendFailed: "Raporttia ei voitu lähettää",
    sent: "Kiitos — raportti on matkalla",
    queued: "Tallennettu — se lähetetään, kun olet taas verkossa",
  },
  ui: {
    trigger: "Palaute",
    title: "Ilmoita ongelmasta",
    intro: "Kerro, mikä meni pieleen tai mitä jäit kaipaamaan.",
    typeLabel: "Ilmoituksen tyyppi",
    types: { bug: "Virhe", idea: "Idea", other: "Muu" },
    messageLabel: "Mitä tapahtui?",
    messagePlaceholder: "Mikä on väärin, puuttuu tai on sekavaa?",
    contactLabel: "Miten voimme tavoittaa sinut?",
    contactHint: "Käytetään vain tähän ilmoitukseen vastaamiseen.",
    contactRequired: "Kerro, miten voimme tavoittaa sinut",
    screenshot: "Liitä kuva tästä sivusta",
    screenshotNote: "Kuva näyttää tämän sivun sellaisena kuin näet sen nyt.",
    annotate: "Muokkaa kuvaa",
    annotateArea:
      "Piirtoalue. Merkitse kuvaa vetämällä valitulla työkalulla. Askelpalautin kumoaa, Esc peruu merkinnän, jota olet piirtämässä, ja kun mitään ei piirretä, poistuu editorista säilyttämättä merkintöjä.",
    toolLabel: "Piirtotyökalu",
    toolRect: "Suorakulmio",
    toolArrow: "Nuoli",
    toolBlur: "Sumennus",
    undo: "Kumoa",
    done: "Valmis",
    pickElement: "Osoita elementtiä",
    picking: "Napsauta sitä, minkä haluat liittää — Esc lopettaa",
    pickingAnnounce:
      "Osoitustila. Napsauta sivun elementtiä liittääksesi sen, tai lopeta painamalla Esc.",
    pickingDone: "Osoitustila päättyi.",
    attached: "Liitetty",
    remove: "Poista",
    removeElement: "Poista {element}",
    send: "Lähetä",
    sending: "Lähetetään…",
    close: "Sulje",
    closeDialog: "Sulje ilmoituspaneeli",
    thanks: "Kiitos. Olemme vastaanottaneet ilmoituksesi.",
    openedByError: "Tällä sivulla meni jokin pieleen. Haluatko kertoa, mitä olit tekemässä?",
  },
  email: {
    subject: "Uusi ilmoitus: {title}",
    intro: "Sovelluksestasi saapui uusi ilmoitus. Tiedot ovat alla.",
  },
};

export const uk: Locale = {
  code: "uk",
  messages: {
    empty: "Спершу напишіть повідомлення",
    screenshotTooLarge: "Зображення завелике — надсилаємо без нього",
    screenshotFailed: "Не вдалося зробити знімок — ви можете надіслати без нього",
    sendFailed: "Не вдалося надіслати звіт",
    sent: "Дякуємо — звіт уже в дорозі",
    queued: "Збережено — надішлемо, коли ви знову будете онлайн",
  },
  ui: {
    trigger: "Відгук",
    title: "Повідомити про проблему",
    intro: "Розкажіть, що пішло не так або чого вам бракує.",
    typeLabel: "Тип звіту",
    types: { bug: "Помилка", idea: "Ідея", other: "Інше" },
    messageLabel: "Що сталося?",
    messagePlaceholder: "Що не так, чого бракує або що заплутує?",
    contactLabel: "Як з вами зв’язатися?",
    contactHint: "Використовуємо лише для відповіді на цей звіт.",
    contactRequired: "Напишіть, як з вами зв’язатися",
    screenshot: "Долучити зображення цієї сторінки",
    screenshotNote: "Зображення показує цю сторінку такою, якою ви бачите її зараз.",
    annotate: "Редагувати зображення",
    annotateArea:
      "Область малювання. Проведіть, щоб позначити зображення вибраним інструментом. Backspace скасовує, Esc припиняє позначку, яку ви малюєте, а коли нічого не малюється — виходить з редактора, не зберігаючи позначок.",
    toolLabel: "Інструмент малювання",
    toolRect: "Прямокутник",
    toolArrow: "Стрілка",
    toolBlur: "Розмиття",
    undo: "Скасувати",
    done: "Готово",
    pickElement: "Вказати на елемент",
    picking: "Клацніть те, що хочете долучити — Esc, щоб зупинити",
    pickingAnnounce:
      "Режим вказування. Клацніть будь-який елемент сторінки, щоб долучити його, або натисніть Esc, щоб зупинити.",
    pickingDone: "Режим вказування завершено.",
    attached: "Долучено",
    remove: "Вилучити",
    removeElement: "Вилучити {element}",
    send: "Надіслати",
    sending: "Надсилання…",
    close: "Закрити",
    closeDialog: "Закрити панель звіту",
    thanks: "Дякуємо. Ми отримали ваш звіт.",
    openedByError: "На цій сторінці щось пішло не так. Хочете розповісти, що ви робили?",
  },
  email: {
    subject: "Новий звіт: {title}",
    intro: "З вашої програми надійшов новий звіт. Подробиці нижче.",
  },
};

/** The five optional locales, keyed by code, to merge into `locales`. */
export const localesExtra: Record<string, Locale> = { it, pl, pt, fi, uk };
