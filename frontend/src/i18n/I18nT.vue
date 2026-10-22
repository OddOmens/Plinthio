<script>
// A translated sentence with markup inside it — a link, a <code>, a bold word — without
// splitting the sentence into pieces that can't be reordered for another language.
//   "settings.restartHint": "Open {link} and press Restart."
//   <I18nT keypath="settings.restartHint"><template #link><a href="…">{{ $t('…') }}</a></template></I18nT>
// Each {name} becomes the slot of that name, or params[name] as text.
import { h, Fragment } from 'vue';
import { t } from './index';

export default {
  name: 'I18nT',
  props: {
    keypath: { type: String, required: true },
    params: { type: Object, default: () => ({}) },
    tag: { type: String, default: 'span' }
  },
  setup(props, { slots }) {
    return () => {
      // Format with each slot name left as its own placeholder, then split on them.
      const keep = Object.fromEntries(Object.keys(slots).map((name) => [name, `{${name}}`]));
      const text = t(props.keypath, { ...props.params, ...keep });
      const children = text.split(/(\{\w+\})/).filter(Boolean).map((part) => {
        const name = part.match(/^\{(\w+)\}$/)?.[1];
        return name && slots[name] ? h(Fragment, slots[name]()) : part;
      });
      return props.tag ? h(props.tag, children) : h(Fragment, children);
    };
  }
};
</script>
