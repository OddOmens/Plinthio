<template>
  <SectionHeader :title="$t('admin.users.title')" :description="$t('admin.users.description')">
    <button @click="openAddUser" class="btn btn-primary">
      <UserPlus class="w-3.5 h-3.5" /> {{ $t('admin.users.add') }}
    </button>
  </SectionHeader>

  <SettingsCard flush>
    <ul class="divide-y divide-border">
      <li v-for="u in users" :key="u.id">
        <button type="button" @click="openEditUser(u)" class="w-full px-4 sm:px-5 py-3 flex items-center gap-3 text-left hover:bg-muted/40 transition" :aria-label="$t('admin.users.editAria', { name: u.username })">
          <img v-if="u.avatar" :src="u.avatar" alt="" class="w-9 h-9 rounded-full object-cover border border-border flex-shrink-0" @error="u.avatar = null" />
          <span v-else class="w-9 h-9 rounded-full bg-muted text-foreground flex items-center justify-center font-semibold text-xs border border-border flex-shrink-0 select-none">
            {{ u.username.slice(0, 1).toUpperCase() }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2 min-w-0">
              <span class="text-xs font-semibold text-foreground truncate">{{ u.username }}</span>
              <span v-if="u.id === authStore.user?.id" class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0">{{ $t('admin.users.you') }}</span>
              <span :class="['text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize flex-shrink-0', roleBadgeClass(u.role)]">{{ roleLabel(u.role) }}</span>
            </span>
            <span class="flex items-center gap-1.5 flex-wrap mt-1 text-[12px] text-muted-foreground">
              <span>{{ u.last_login_at ? $t('admin.users.lastIn', { date: formatDateTime(u.last_login_at) }) : $t('admin.users.neverSignedIn') }}<template v-if="u.last_login_at && u.last_login_network && u.last_login_network !== 'home'"> {{ $t('admin.users.network', { network: u.last_login_network === 'tailscale' ? 'Tailscale' : $t('admin.users.outside') }) }}</template></span>
              <span v-for="b in badges(u)" :key="b.label" :class="['inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', b.tone]" :title="b.title">
                <component :is="b.icon" class="w-2.5 h-2.5" /> {{ b.label }}
              </span>
            </span>
          </span>
          <ChevronRight class="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </button>
      </li>
    </ul>
  </SettingsCard>

  <!-- Add -->
  <SettingsDialog :open="showAdd" :title="$t('admin.users.addDialog.title')" @close="showAdd = false">
    <form id="add-user-form" @submit.prevent="submitAddUser" class="flex flex-col gap-4">
      <div>
        <label for="new-username" class="field-label">{{ $t('common.username') }}</label>
        <input id="new-username" v-model="newUser.username" required autocomplete="off" class="field" />
      </div>
      <div>
        <label for="new-user-password" class="field-label">{{ $t('common.password') }}</label>
        <input id="new-user-password" v-model="newUser.password" type="password" required minlength="8" autocomplete="new-password" class="field" />
        <p class="field-hint">{{ $t('admin.users.addDialog.passwordHint') }}</p>
      </div>
      <RolePicker v-model="newUser.role" />
      <div>
        <label for="new-user-limit" class="field-label">{{ $t('admin.users.access') }}</label>
        <select id="new-user-limit" v-model="newUser.duration" class="field">
          <option value="forever">{{ $t('admin.users.noEndDate') }}</option>
          <option v-for="d in DURATIONS" :key="d.id" :value="d.id">{{ $t('admin.users.forDuration', { duration: d.label }) }}</option>
          <option value="custom">{{ $t('admin.users.untilDate') }}</option>
        </select>
        <input v-if="newUser.duration === 'custom'" v-model="newUser.customExpiry" type="datetime-local" required :aria-label="$t('admin.users.accessEnds')" class="field mt-2" />
      </div>
    </form>
    <template #footer>
      <button type="button" @click="showAdd = false" class="btn btn-secondary ml-auto">{{ $t('common.cancel') }}</button>
      <button type="submit" form="add-user-form" :disabled="saving" class="btn btn-primary">{{ saving ? $t('admin.users.addDialog.adding') : $t('admin.users.add') }}</button>
    </template>
  </SettingsDialog>

  <!-- Edit -->
  <SettingsDialog :open="!!edit" :title="edit ? $t('admin.users.editDialog.title', { name: edit.original.username }) : ''" :subtitle="edit ? $t('admin.users.editDialog.joined', { date: formatDate(edit.original.created_at) }) : ''" width="sm:max-w-lg" @close="edit = null">
    <form v-if="edit" id="edit-user-form" @submit.prevent="submitEditUser" class="flex flex-col gap-5">
      <div>
        <label for="edit-username" class="field-label">{{ $t('common.username') }}</label>
        <input id="edit-username" v-model="edit.username" required class="field" />
      </div>

      <RolePicker v-if="!edit.isSelf" v-model="edit.role" />

      <fieldset class="flex flex-col gap-2">
        <legend class="field-label flex items-center gap-1.5"><Hourglass class="w-3.5 h-3.5 text-muted-foreground" /> {{ $t('admin.users.access') }}</legend>
        <p class="text-[12px] text-muted-foreground -mt-1">
          <template v-if="edit.original.expires_at">
            <span :class="isExpired(edit.original) ? 'text-destructive font-semibold' : 'text-foreground font-medium'">{{ $t(isExpired(edit.original) ? 'admin.users.ended' : 'admin.users.ends', { date: formatDateTime(edit.original.expires_at) }) }}</span>
          </template>
          <template v-else>{{ $t('admin.users.noEndDateSentence') }}</template>
        </p>
        <div v-if="!edit.isSelf && edit.original.expires_at" class="flex flex-wrap gap-1.5">
          <button v-for="d in QUICK_EXTEND" :key="d.id" type="button" @click="extend(d.id)" :disabled="extending" class="btn btn-secondary h-8">{{ $t('admin.users.extendBy', { duration: d.label }) }}</button>
          <button type="button" @click="extend('forever')" :disabled="extending" class="btn btn-secondary h-8">{{ $t('admin.users.removeEndDate') }}</button>
        </div>
        <select v-model="edit.duration" class="field" :aria-label="$t('admin.users.setAccess')">
          <option value="unchanged">{{ edit.original.expires_at ? $t('admin.users.setNewEnd') : $t('admin.users.keepNoEnd') }}</option>
          <option v-if="edit.original.expires_at" value="forever">{{ $t('admin.users.noEndDate') }}</option>
          <option v-for="d in DURATIONS" :key="d.id" :value="d.id">{{ $t('admin.users.fromNow', { duration: d.label }) }}</option>
          <option value="custom">{{ $t('admin.users.untilDate') }}</option>
        </select>
        <input v-if="edit.duration === 'custom'" v-model="edit.customExpiry" type="datetime-local" required :aria-label="$t('admin.users.accessEnds')" class="field" />
      </fieldset>

      <div class="flex flex-col divide-y divide-border border-y border-border">
        <div class="py-3"><ToggleRow v-model="edit.remoteAccess" :label="$t('admin.users.remote.label')" :icon="Globe" :description="$t('admin.users.remote.desc')" /></div>
        <div v-if="!edit.isSelf && edit.role !== 'admin'" class="py-3"><ToggleRow v-model="edit.kidsMode" :label="$t('admin.users.kidsAccount.label')" :icon="Baby" :description="$t('admin.users.kidsAccount.desc')" /></div>
        <div v-if="edit.twoFactor" class="py-3 flex items-start justify-between gap-3">
          <span>
            <span class="text-xs font-semibold text-foreground flex items-center gap-1.5"><ShieldCheck class="w-3.5 h-3.5 text-emerald-500" /> {{ $t('admin.users.twoFactorOn') }}</span>
            <span class="block text-[12px] text-muted-foreground mt-0.5">{{ $t('admin.users.twoFactorHelp') }}</span>
          </span>
          <button type="button" @click="resetTwoFactor" class="btn btn-danger h-8 flex-shrink-0">{{ $t('common.reset') }}</button>
        </div>
      </div>

      <div v-if="!edit.isSelf">
        <label for="edit-content-limit" class="field-label flex items-center gap-1.5"><ShieldCheck class="w-3.5 h-3.5 text-muted-foreground" /> {{ $t('admin.users.contentLimit') }}</label>
        <select id="edit-content-limit" v-model="edit.maxAgeRating" class="field">
          <option value="">{{ $t('admin.users.noLimit') }}</option>
          <option value="Everyone">{{ $t('admin.users.everyoneOnly') }}</option>
          <option value="Teen">{{ $t('admin.users.upTo', { rating: ratingLabel('Teen') }) }}</option>
          <option value="Mature">{{ $t('admin.users.upTo', { rating: ratingLabel('Mature') }) }}</option>
        </select>
        <label v-if="edit.maxAgeRating" class="mt-2 flex items-start gap-2 text-[12px] text-muted-foreground cursor-pointer">
          <input v-model="edit.allowUnrated" type="checkbox" class="mt-0.5 rounded border-border accent-primary focus:ring-ring" />
          <span>{{ $t('admin.users.allowUnrated') }}</span>
        </label>
        <p class="field-hint">{{ $t('admin.users.ratingsHint') }}</p>
      </div>

      <div>
        <label for="edit-password" class="field-label flex items-center gap-1.5"><KeyRound class="w-3.5 h-3.5 text-muted-foreground" /> {{ $t('admin.users.newPassword') }}</label>
        <input id="edit-password" v-model="edit.newPassword" type="password" autocomplete="new-password" minlength="8" :placeholder="$t('admin.users.newPasswordPlaceholder')" class="field" />
        <p class="field-hint">{{ $t('admin.users.newPasswordHint') }}</p>
      </div>
    </form>
    <template #footer>
      <button v-if="edit && !edit.isSelf" type="button" @click="deleteUser" class="btn btn-danger">
        <Trash2 class="w-3.5 h-3.5" /> {{ $t('common.delete') }}
      </button>
      <button type="button" @click="edit = null" class="btn btn-secondary ml-auto">{{ $t('common.cancel') }}</button>
      <button type="submit" form="edit-user-form" :disabled="saving" class="btn btn-primary">{{ saving ? $t('common.saving') : $t('common.save') }}</button>
    </template>
  </SettingsDialog>
</template>

<script setup>
import { ref, h } from 'vue';
import { UserPlus, ChevronRight, Hourglass, Globe, Baby, ShieldCheck, KeyRound, Trash2, House, Lock, PenSquare, Eye } from '@lucide/vue';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { useDialogStore } from '../../stores/dialog';
import { formatDate, formatDateTime } from '../../utils/settingsFormat';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsDialog from '../settings/SettingsDialog.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import { t, te } from '../../i18n';

defineProps({
  users: { type: Array, default: () => [] }
});
const emit = defineEmits(['changed']);
const authStore = useAuthStore();
const dialog = useDialogStore();

// Labels are getters so they follow the current language.
const duration = (id, count, unit) => ({ id, get label() { return t(`admin.users.durations.${unit}`, { count }); } });
const DURATIONS = [
  duration('1d', 1, 'day'), duration('3d', 3, 'day'), duration('7d', 1, 'week'),
  duration('14d', 2, 'week'), duration('1m', 1, 'month'), duration('3m', 3, 'month'),
  duration('6m', 6, 'month'), duration('1y', 1, 'year')
];
const QUICK_EXTEND = [duration('1d', 1, 'day'), duration('7d', 1, 'week'), duration('1m', 1, 'month')];

const role = (id, icon) => ({
  id,
  icon,
  get label() { return t(`admin.users.roles.${id}.label`); },
  get desc() { return t(`admin.users.roles.${id}.desc`); }
});
const ROLES = [role('viewer', Eye), role('editor', PenSquare), role('admin', ShieldCheck)];
const roleLabel = (id) => ROLES.find((r) => r.id === id)?.label || id;

// Age ratings are stored in English (Everyone, Teen, Mature); only the label is translated.
const ratingLabel = (value) => {
  const key = `admin.users.ageRatings.${String(value).toLowerCase()}`;
  return te(key) ? t(key) : value;
};

// Role tiles, shared by Add and Edit.
const RolePicker = (props, { emit: emitRole }) => h('div', [
  h('p', { class: 'field-label' }, t('admin.users.roles.label')),
  h('div', { class: 'flex flex-col gap-1.5', role: 'radiogroup', 'aria-label': t('admin.users.roles.label') }, ROLES.map((r) => h('button', {
    type: 'button',
    role: 'radio',
    'aria-checked': props.modelValue === r.id,
    onClick: () => emitRole('update:modelValue', r.id),
    class: [
      'p-2.5 rounded-lg border text-left flex items-start gap-2.5 transition',
      props.modelValue === r.id ? 'border-primary ring-2 ring-primary/20 bg-muted/40' : 'border-border hover:bg-muted/30'
    ]
  }, [
    h(r.icon, { class: 'w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0' }),
    h('span', [
      h('span', { class: 'block text-xs font-semibold text-foreground' }, r.label),
      h('span', { class: 'block text-[12px] text-muted-foreground' }, r.desc)
    ])
  ])))
]);
RolePicker.props = ['modelValue'];
RolePicker.emits = ['update:modelValue'];

function roleBadgeClass(role) {
  if (role === 'admin') return 'bg-primary/10 text-primary border-primary/20';
  if (role === 'editor') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
  return 'bg-muted text-muted-foreground border-border';
}

const isExpired = (u) => !!u.expires_at && new Date(u.expires_at).getTime() <= Date.now();

function expiryLabel(u) {
  const ms = new Date(u.expires_at).getTime() - Date.now();
  if (ms <= 0) return t('admin.users.accessEnded');
  const days = Math.ceil(ms / 86400000);
  return days <= 1
    ? t('admin.users.hoursLeft', { count: Math.max(1, Math.ceil(ms / 3600000)) })
    : t('admin.users.daysLeft', { count: days });
}

// The little tags under a name: what's different about this account.
function badges(u) {
  const out = [];
  if (u.expires_at) {
    const soon = !isExpired(u) && new Date(u.expires_at).getTime() - Date.now() <= 86400000;
    out.push({
      label: expiryLabel(u), icon: isExpired(u) ? Lock : Hourglass, title: t('admin.users.ends', { date: formatDateTime(u.expires_at) }),
      tone: isExpired(u) ? 'bg-destructive/15 text-destructive' : soon ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    });
  }
  if (u.two_factor) out.push({ label: t('admin.users.badges.twoFactor'), icon: ShieldCheck, tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', title: t('admin.users.badges.twoFactorTitle') });
  if (u.remote_access === 0) out.push({ label: t('admin.users.badges.homeOnly'), icon: House, tone: 'bg-muted text-muted-foreground', title: t('admin.users.badges.homeOnlyTitle') });
  if (u.kids_mode) out.push({ label: t('admin.users.badges.kids'), icon: Baby, tone: 'bg-sky-500/15 text-sky-500' });
  if (u.max_age_rating) {
    out.push({
      label: t('admin.users.upTo', { rating: ratingLabel(u.max_age_rating) }), icon: ShieldCheck, tone: 'bg-sky-500/15 text-sky-500',
      title: u.allow_unrated === 0 ? t('admin.users.badges.unratedHidden') : t('admin.users.badges.unratedAllowed')
    });
  }
  return out;
}

const saving = ref(false);

// ─── Add ──────────────────────────────────────────────────────────────────
const showAdd = ref(false);
const newUser = ref({});
function openAddUser() {
  newUser.value = { username: '', password: '', role: 'viewer', duration: 'forever', customExpiry: '' };
  showAdd.value = true;
}
async function submitAddUser() {
  saving.value = true;
  try {
    await api.post('/users', {
      username: newUser.value.username,
      password: newUser.value.password,
      role: newUser.value.role,
      duration: newUser.value.duration === 'custom' ? newUser.value.customExpiry : newUser.value.duration
    });
    showAdd.value = false;
    emit('changed');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.users.couldNotAdd'));
  } finally {
    saving.value = false;
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────
const edit = ref(null);
function openEditUser(u) {
  edit.value = {
    original: u,
    isSelf: u.id === authStore.user?.id,
    username: u.username,
    role: u.role,
    newPassword: '',
    duration: 'unchanged',
    customExpiry: '',
    maxAgeRating: u.max_age_rating || '',
    allowUnrated: u.allow_unrated !== 0,
    kidsMode: !!u.kids_mode,
    remoteAccess: u.remote_access !== 0,
    twoFactor: !!u.two_factor
  };
}

const extending = ref(false);
async function extend(duration) {
  const u = edit.value.original;
  extending.value = true;
  try {
    const res = await api.post(`/users/${u.id}/extend`, { duration });
    u.expires_at = res.data.user?.expires_at ?? null;
    emit('changed');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.users.couldNotChangeAccess'));
  } finally {
    extending.value = false;
  }
}

async function submitEditUser() {
  const e = edit.value;
  const u = e.original;
  if (e.newPassword && e.newPassword.length < 8) {
    dialog.alert(t('admin.users.passwordTooShort'));
    return;
  }
  saving.value = true;
  try {
    if (!e.isSelf && e.role !== u.role) {
      await api.patch(`/users/${u.id}/role`, { role: e.role });
    }
    const updates = {};
    if (e.username.trim() !== u.username) updates.username = e.username.trim();
    if (!e.isSelf) {
      if ((e.maxAgeRating || '') !== (u.max_age_rating || '')) updates.maxAgeRating = e.maxAgeRating || null;
      if (e.allowUnrated !== (u.allow_unrated !== 0)) updates.allowUnrated = e.allowUnrated;
      if (e.kidsMode !== !!u.kids_mode) updates.kidsMode = e.kidsMode;
    }
    if (e.remoteAccess !== (u.remote_access !== 0)) updates.remoteAccess = e.remoteAccess;
    if (e.duration !== 'unchanged') updates.duration = e.duration === 'custom' ? e.customExpiry : e.duration;
    if (Object.keys(updates).length) await api.patch(`/users/${u.id}`, updates);
    if (e.newPassword) await api.patch(`/users/${u.id}/password`, { newPassword: e.newPassword });
    edit.value = null;
    emit('changed');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.users.couldNotSave'));
    emit('changed');
  } finally {
    saving.value = false;
  }
}

async function resetTwoFactor() {
  const u = edit.value.original;
  const ok = await dialog.confirm({
    title: t('admin.users.resetTitle'),
    message: t('admin.users.resetMessage', { name: u.username }),
    confirmText: t('common.reset'),
    danger: true
  });
  if (!ok) return;
  try {
    const res = await api.post(`/users/${u.id}/two-factor/reset`);
    if (edit.value) edit.value.twoFactor = false;
    emit('changed');
    dialog.alert(res.data.message);
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.users.couldNotReset'));
  }
}

async function deleteUser() {
  const u = edit.value.original;
  const confirmed = await dialog.confirm({
    title: t('admin.users.deleteTitle'),
    message: t('admin.users.deleteMessage', { name: u.username }),
    confirmText: t('admin.users.deleteUser'),
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.delete(`/users/${u.id}`);
    edit.value = null;
    emit('changed');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.users.couldNotDelete'));
  }
}
</script>
