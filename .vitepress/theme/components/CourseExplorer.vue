<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Tag from "primevue/tag";
import type {
  CourseCatalogCourse,
  CourseCatalogIndex,
  CourseCatalogOccurrence,
} from "../course-catalog";

const { catalog } = defineProps<{ catalog: CourseCatalogIndex }>();

type ViewMode = "plan" | "search";
type MaterialFilter = "all" | "available" | "missing";

interface PlanCourseCard {
  course: CourseCatalogCourse;
  occurrence: CourseCatalogOccurrence;
}
const modeOptions = [
  {
    value: "plan",
    label: "我的培养方案",
    description: "按年级、学院、专业和学期浏览",
    icon: "pi pi-sitemap",
  },
  {
    value: "search",
    label: "直接找课程",
    description: "按名称、代码、学院和资料状态检索",
    icon: "pi pi-search",
  },
] satisfies Array<{
  value: ViewMode;
  label: string;
  description: string;
  icon: string;
}>;
const yearOptions = catalog.years.map((year) => ({
  label: `${year} 级`,
  value: year,
}));
const materialOptions = [
  { label: "全部课程", value: "all" },
  { label: "已有资料", value: "available" },
  { label: "待补充资料", value: "missing" },
] satisfies Array<{ label: string; value: MaterialFilter }>;

const mode = ref<ViewMode>("plan");
const selectedYear = ref(catalog.years[0] ?? "");
const selectedSchool = ref("");
const selectedPlanId = ref("");
const selectedTerm = ref("all");
const keyword = ref("");
const offeringCollege = ref("");
const trainingSchool = ref("");
const searchTerm = ref("");
const materialFilter = ref<MaterialFilter>("all");
const resultLimit = ref(48);

const courseByCode = new Map(
  catalog.courses.map((course) => [course.code, course]),
);

const schoolOptions = computed(() =>
  Array.from(
    new Set(
      catalog.plans
        .filter((plan) => plan.year === selectedYear.value)
        .map((plan) => plan.school),
    ),
  ).sort((a, b) => a.localeCompare(b, "zh-CN")),
);
const schoolSelectOptions = computed(() =>
  schoolOptions.value.map((school) => ({ label: school, value: school })),
);


const majorOptions = computed(() =>
  catalog.plans
    .filter(
      (plan) =>
        plan.year === selectedYear.value &&
        plan.school === selectedSchool.value,
    )
    .sort((a, b) => a.majorName.localeCompare(b.majorName, "zh-CN")),
);
const majorSelectOptions = computed(() =>
  majorOptions.value.map((plan) => ({
    label: plan.majorName,
    value: plan.id,
  })),
);


const selectedPlan = computed(() =>
  catalog.plans.find((plan) => plan.id === selectedPlanId.value),
);

const planGroups = computed(() => {
  const plan = selectedPlan.value;
  if (!plan) return [];
  const requestedTerms =
    selectedTerm.value === "all" ? plan.terms : [selectedTerm.value];
  return requestedTerms
    .map((term) => {
      const seen = new Set<string>();
      const courses = catalog.occurrences
        .filter(
          (occurrence) =>
            occurrence.planId === plan.id && occurrence.term === term,
        )
        .flatMap((occurrence): PlanCourseCard[] => {
          if (seen.has(occurrence.courseCode)) return [];
          seen.add(occurrence.courseCode);
          const course = courseByCode.get(occurrence.courseCode);
          return course ? [{ course, occurrence }] : [];
        })
        .sort(
          (a, b) =>
            Number(b.course.hasMaterial) - Number(a.course.hasMaterial) ||
            a.course.name.localeCompare(b.course.name, "zh-CN"),
        );
      return { term, courses };
    })
    .filter((group) => group.courses.length > 0);
});

const normalizedKeyword = computed(() => keyword.value.trim().toLowerCase());
const filteredCourses = computed(() =>
  catalog.courses.filter((course) => {
    const query = normalizedKeyword.value;
    if (
      query &&
      ![course.code, course.name, ...course.aliases]
        .join(" ")
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }
    if (
      offeringCollege.value &&
      !course.offeringColleges.includes(offeringCollege.value)
    ) {
      return false;
    }
    if (
      trainingSchool.value &&
      !course.schools.includes(trainingSchool.value)
    ) {
      return false;
    }
    if (searchTerm.value && !course.terms.includes(searchTerm.value)) {
      return false;
    }
    if (materialFilter.value === "available" && !course.hasMaterial) {
      return false;
    }
    if (materialFilter.value === "missing" && course.hasMaterial) {
      return false;
    }
    return true;
  }),
);
const visibleCourses = computed(() =>
  filteredCourses.value.slice(0, resultLimit.value),
);

watch(selectedYear, () => {
  selectedSchool.value = "";
  selectedPlanId.value = "";
  selectedTerm.value = "all";
});
watch(selectedSchool, () => {
  selectedPlanId.value = "";
  selectedTerm.value = "all";
});
watch(selectedPlanId, () => {
  selectedTerm.value = "all";
});
watch(
  [keyword, offeringCollege, trainingSchool, searchTerm, materialFilter],
  () => {
    resultLimit.value = 48;
  },
);

const courseLink = (code: string) => `/courses/${encodeURIComponent(code)}`;
const readableTerm = (term: string) =>
  term
    .replace("第一学年", "大一 · ")
    .replace("第二学年", "大二 · ")
    .replace("第三学年", "大三 · ")
    .replace("第四学年", "大四 · ")
    .replace("第五学年", "大五 · ")
    .replace("秋季", "秋")
    .replace("春季", "春")
    .replace("夏季", "夏");
const readableBytes = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};
const offeringCollegeOptions = computed(() =>
  catalog.offeringColleges.map((college) => ({
    label: college,
    value: college,
  })),
);
const trainingSchoolOptions = computed(() =>
  catalog.schools.map((school) => ({ label: school, value: school })),
);
const searchTermOptions = computed(() =>
  catalog.terms.map((term) => ({
    label: readableTerm(term),
    value: term,
  })),
);
</script>

<template>
  <main class="course-explorer">
    <section class="catalog-hero">
      <div>
        <p class="catalog-eyebrow">薪火课程中心</p>
        <h1>先找到这学期，再找到这门课</h1>
        <p class="catalog-lead">
          按培养方案浏览你的完整课程路径，或直接按学院、课程名和资料状态检索。
        </p>
      </div>
      <dl class="catalog-stats" aria-label="课程目录统计">
        <div>
          <dt>{{ catalog.plans.length }}</dt>
          <dd>培养方案</dd>
        </div>
        <div>
          <dt>{{ catalog.courses.length }}</dt>
          <dd>课程代码</dd>
        </div>
        <div>
          <dt>
            {{ catalog.courses.filter((course) => course.hasMaterial).length }}
          </dt>
          <dd>已有资料</dd>
        </div>
      </dl>
    </section>

    <SelectButton
      v-model="mode"
      class="mode-switch"
      :options="modeOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      aria-label="课程查看模式"
    >
      <template #option="{ option }">
        <span class="mode-option">
          <i :class="['mode-icon', option.icon]" aria-hidden="true" />
          <span>
            <strong>{{ option.label }}</strong>
            <small>{{ option.description }}</small>
          </span>
        </span>
      </template>
    </SelectButton>


    <section v-if="mode === 'plan'" class="catalog-panel plan-panel">
      <header class="panel-heading">
        <div>
          <span class="step-number">1</span>
          <h2>选择你的培养方案</h2>
        </div>
        <p>选择会逐级缩小，不需要记专业代码。</p>
      </header>
      <div class="selector-grid">
        <label>
          <span>年级 / 方案年份</span>
          <Select
            v-model="selectedYear"
            :options="yearOptions"
            option-label="label"
            option-value="value"
            fluid
          />
        </label>
        <label>
          <span>培养学院</span>
          <Select
            v-model="selectedSchool"
            :options="schoolSelectOptions"
            option-label="label"
            option-value="value"
            placeholder="请选择学院"
            filter
            fluid
          />
        </label>
        <label>
          <span>专业</span>
          <Select
            v-model="selectedPlanId"
            :options="majorSelectOptions"
            option-label="label"
            option-value="value"
            placeholder="请选择专业"
            :disabled="!selectedSchool"
            filter
            fluid
          />
        </label>
      </div>


      <template v-if="selectedPlan">
        <div class="term-toolbar">
          <div>
            <span class="step-number">2</span>
            <div>
              <h2>选择学年与学期</h2>
              <p>{{ selectedPlan.majorName }} · {{ selectedPlan.version }}</p>
            </div>
          </div>
          <SelectButton
            v-model="selectedTerm"
            class="term-chips"
            :options="[
              { label: '全部学期', value: 'all' },
              ...selectedPlan.terms.map((term) => ({
                label: readableTerm(term),
                value: term,
              })),
            ]"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            aria-label="选择学期"
          />
        </div>


        <div class="term-groups">
          <section
            v-for="group in planGroups"
            :key="group.term"
            class="term-group"
          >
            <header>
              <div>
                <span class="term-dot"></span>
                <h3>{{ readableTerm(group.term) }}</h3>
              </div>
              <span>{{ group.courses.length }} 门课</span>
            </header>
            <div class="course-grid">
              <a
                v-for="item in group.courses"
                :key="item.course.code"
                class="course-card"
                :href="courseLink(item.course.code)"
              >
                <div class="card-topline">
                  <span class="course-code">{{ item.course.code }}</span>
                  <Tag
                    :value="item.course.hasMaterial ? '有资料' : '待补充'"
                    :severity="item.course.hasMaterial ? 'success' : 'secondary'"
                    rounded
                  />
                </div>
                <h4>{{ item.course.name }}</h4>
                <p class="course-meta">
                  <span v-if="item.occurrence.credit !== undefined"
                    >{{ item.occurrence.credit }} 学分</span
                  >
                  <span v-if="item.occurrence.totalHours !== undefined"
                    >{{ item.occurrence.totalHours }} 学时</span
                  >
                  <span v-if="item.occurrence.courseNature">{{
                    item.occurrence.courseNature
                  }}</span>
                </p>
                <p class="course-college">
                  {{
                    item.occurrence.offeringCollege ||
                    item.course.offeringColleges[0] ||
                    "开课学院未标注"
                  }}
                </p>
                <div v-if="item.course.hasMaterial" class="resource-summary">
                  {{ item.course.fileCount }} 个文件 ·
                  {{ readableBytes(item.course.bytes) }}
                </div>
              </a>
            </div>
          </section>
        </div>
      </template>

      <div v-else class="empty-guide">
        <span>↖</span>
        <div>
          <strong>从上面选好年级、学院和专业</strong>
          <p>课程会自动按大一到大五、秋春夏学期分组展示。</p>
        </div>
      </div>
    </section>

    <section v-else class="catalog-panel search-panel">
      <header class="panel-heading">
        <div>
          <span class="step-number">⌕</span>
          <h2>直接检索一门课程</h2>
        </div>
        <p>多个条件可以组合；全部留空时展示完整目录。</p>
      </header>
      <IconField class="search-box">
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="keyword"
          type="search"
          placeholder="输入课程名称、课程代码或别名"
          fluid
        />
      </IconField>
      <div class="filter-grid">
        <label>
          <span>开课学院</span>
          <Select
            v-model="offeringCollege"
            :options="offeringCollegeOptions"
            option-label="label"
            option-value="value"
            placeholder="全部开课学院"
            filter
            fluid
          />
        </label>
        <label>
          <span>培养学院</span>
          <Select
            v-model="trainingSchool"
            :options="trainingSchoolOptions"
            option-label="label"
            option-value="value"
            placeholder="全部培养学院"
            filter
            fluid
          />
        </label>
        <label>
          <span>推荐学期</span>
          <Select
            v-model="searchTerm"
            :options="searchTermOptions"
            option-label="label"
            option-value="value"
            placeholder="全部学期"
            fluid
          />
        </label>
        <label>
          <span>资料状态</span>
          <Select
            v-model="materialFilter"
            :options="materialOptions"
            option-label="label"
            option-value="value"
            fluid
          />
        </label>
      </div>


      <div class="result-heading">
        <div>
          <strong>{{ filteredCourses.length }}</strong> 门课程符合条件
        </div>
        <Button
          v-if="
            keyword ||
            offeringCollege ||
            trainingSchool ||
            searchTerm ||
            materialFilter !== 'all'
          "
          label="清空筛选"
          icon="pi pi-filter-slash"
          severity="secondary"
          variant="outlined"
          rounded
          size="small"
          @click="
            keyword = '';
            offeringCollege = '';
            trainingSchool = '';
            searchTerm = '';
            materialFilter = 'all';
          "
        />

      </div>

      <div v-if="visibleCourses.length" class="course-grid search-results">
        <a
          v-for="course in visibleCourses"
          :key="course.code"
          class="course-card"
          :href="courseLink(course.code)"
        >
          <div class="card-topline">
            <span class="course-code">{{ course.code }}</span>
            <Tag
              :value="course.hasMaterial ? '有资料' : '待补充'"
              :severity="course.hasMaterial ? 'success' : 'secondary'"
              rounded
            />
          </div>
          <h3>{{ course.name }}</h3>
          <p class="course-college">
            {{
              course.offeringColleges.slice(0, 2).join(" · ") ||
              "开课学院未标注"
            }}
          </p>
          <div class="tag-row">
            <span v-for="term in course.terms.slice(0, 3)" :key="term">{{
              readableTerm(term)
            }}</span>
          </div>
          <div v-if="course.hasMaterial" class="resource-summary">
            {{ course.fileCount }} 个文件 · {{ readableBytes(course.bytes) }}
          </div>
        </a>
      </div>
      <div v-else class="no-results">
        <span>○</span><strong>没有找到符合条件的课程</strong>
        <p>试试减少筛选条件，或只输入课程名中的一部分。</p>
      </div>
      <Button
        v-if="visibleCourses.length < filteredCourses.length"
        class="load-more"
        label="再显示 48 门"
        icon="pi pi-plus"
        variant="outlined"
        rounded
        @click="resultLimit += 48"
      />
    </section>
  </main>
</template>

<style scoped>
.course-explorer {
  max-width: 1180px;
  margin: 0 auto;
  padding: 42px 24px 80px;
  color: var(--vp-c-text-1);
}
.catalog-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 40px;
  align-items: end;
  padding: 26px 0 34px;
}
.catalog-eyebrow {
  margin: 0 0 8px;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.catalog-hero h1 {
  margin: 0;
  max-width: 700px;
  border: 0;
  font-size: clamp(34px, 5vw, 58px);
  line-height: 1.05;
  letter-spacing: -0.035em;
}
.catalog-lead {
  max-width: 700px;
  margin: 18px 0 0;
  color: var(--vp-c-text-2);
  font-size: 17px;
  line-height: 1.75;
}
.catalog-stats {
  display: flex;
  gap: 10px;
  margin: 0;
}
.catalog-stats div {
  min-width: 96px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg-soft);
}
.catalog-stats dt {
  font-size: 24px;
  font-weight: 800;
}
.catalog-stats dd {
  margin: 3px 0 0;
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 7px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 22px;
  background: var(--vp-c-bg-soft);
}
.mode-switch :deep(.p-togglebutton) {
  flex: 1 1 0;
  justify-content: flex-start;
  padding: 18px 20px;
  border: 0;
  border-radius: 16px;
  text-align: left;
}

.mode-switch :deep(.p-togglebutton-checked) {
  box-shadow: var(--vp-shadow-2);
}

.mode-option {
  display: flex;
  gap: 14px;
  align-items: center;
}

.mode-option strong,
.mode-option small {
  display: block;
}

.mode-option strong {
  font-size: 16px;
}

.mode-option small {
  margin-top: 3px;
  color: var(--vp-c-text-3);
}

.mode-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  font-size: 22px;
}
.catalog-panel {
  margin-top: 22px;
  padding: 26px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 24px;
  background: var(--vp-c-bg);
  box-shadow: var(--vp-shadow-1);
}
.panel-heading {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: center;
  margin-bottom: 22px;
}
.panel-heading > div,
.term-toolbar > div:first-child {
  display: flex;
  align-items: center;
  gap: 12px;
}
.panel-heading h2,
.term-toolbar h2 {
  margin: 0;
  border: 0;
  font-size: 20px;
}
.panel-heading p,
.term-toolbar p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.step-number {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  font-weight: 800;
}
.selector-grid,
.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.filter-grid {
  grid-template-columns: repeat(4, 1fr);
}
label > span {
  display: block;
  margin: 0 0 7px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 700;
}
.selector-grid :deep(.p-select),
.filter-grid :deep(.p-select),
.search-box :deep(.p-inputtext) {
  width: 100%;
}

.selector-grid :deep(.p-select),
.filter-grid :deep(.p-select) {
  min-height: 44px;
}

.term-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  margin: 28px -4px 18px;
  padding-top: 26px;
  border-top: 1px solid var(--vp-c-divider);
}
.term-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.term-chips :deep(.p-togglebutton) {
  border-radius: 999px;
}

.term-chips :deep(.p-togglebutton-checked) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.term-group {
  margin-top: 26px;
}
.term-group > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.term-group > header > div {
  display: flex;
  gap: 10px;
  align-items: center;
}
.term-group h3 {
  margin: 0;
  border: 0;
  font-size: 17px;
}
.term-group > header > span {
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.term-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 5px var(--vp-c-brand-soft);
}
.course-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.course-card {
  position: relative;
  display: flex;
  min-height: 178px;
  flex-direction: column;
  padding: 17px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  color: inherit !important;
  background: var(--vp-c-bg-soft);
  text-decoration: none !important;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}
.course-card:hover {
  transform: translateY(-2px);
  border-color: var(--vp-c-brand-1);
  box-shadow: var(--vp-shadow-2);
}
.card-topline {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}
.course-code {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
}
.course-card h3,
.course-card h4 {
  margin: 13px 0 7px;
  border: 0;
  font-size: 17px;
  line-height: 1.4;
}
.course-meta,
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.course-meta span,
.tag-row span {
  padding: 3px 7px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-default-soft);
  font-size: 11px;
}
.course-college {
  margin: 8px 0 12px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.55;
}
.resource-summary {
  margin-top: auto;
  padding-top: 11px;
  border-top: 1px solid var(--vp-c-divider);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 700;
}
.empty-guide,
.no-results {
  display: flex;
  justify-content: center;
  gap: 16px;
  align-items: center;
  min-height: 240px;
  color: var(--vp-c-text-2);
  text-align: left;
}
.empty-guide > span,
.no-results > span {
  color: var(--vp-c-brand-1);
  font-size: 38px;
}
.empty-guide strong,
.no-results strong {
  display: block;
  color: var(--vp-c-text-1);
  font-size: 17px;
}
.empty-guide p,
.no-results p {
  margin: 5px 0 0;
}
.search-box {
  position: relative;
  margin-bottom: 16px;
}
.search-box :deep(.p-inputicon) {
  color: var(--vp-c-text-3);
}

.search-box :deep(.p-inputtext) {
  font-size: 16px;
}
.result-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 25px 0 14px;
  color: var(--vp-c-text-2);
}
.result-heading strong {
  color: var(--vp-c-text-1);
  font-size: 22px;
}
.search-results {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.load-more {
  display: flex;
  margin: 24px auto 0;
}
.no-results {
  flex-direction: column;
  min-height: 300px;
  text-align: center;
}
@media (max-width: 900px) {
  .catalog-hero {
    grid-template-columns: 1fr;
  }
  .catalog-stats {
    width: 100%;
  }
  .catalog-stats div {
    flex: 1;
  }
  .course-grid,
  .search-results {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .filter-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .term-toolbar {
    flex-direction: column;
  }
  .term-chips {
    justify-content: flex-start;
  }
}
@media (max-width: 640px) {
  .course-explorer {
    padding: 22px 14px 60px;
  }
  .catalog-hero {
    padding-top: 10px;
  }
  .catalog-stats {
    gap: 6px;
  }
  .catalog-stats div {
    min-width: 0;
    padding: 11px;
  }
  .catalog-stats dt {
    font-size: 19px;
  }
  .mode-switch {
    grid-template-columns: 1fr;
  }
  .catalog-panel {
    padding: 17px;
    border-radius: 18px;
  }
  .panel-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .selector-grid,
  .filter-grid,
  .course-grid,
  .search-results {
    grid-template-columns: 1fr;
  }
  .course-card {
    min-height: 150px;
  }
}
</style>
