<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Card from "primevue/card";
import Message from "primevue/message";
import Button from "primevue/button";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Tag from "primevue/tag";
import type {
  CourseCatalogCourse,
  CourseCatalogOccurrence,
  CoursePlanSourceKind,
} from "../course-catalog";

import type { CourseCatalogDirectory } from "../course-catalog-delivery";
import { loadCoursePlan } from "../course-catalog-client";

const { catalog } = defineProps<{ catalog: CourseCatalogDirectory }>();

type ViewMode = "plan" | "search";
type MaterialFilter = "all" | "available" | "missing";

interface PlanCourseCard {
  course: CourseCatalogCourse;
  occurrence: CourseCatalogOccurrence;
}
const modeOptions = [
  {
    value: "plan",
    label: "我的教学计划",
    description: "按来源、版本或年级、学院、专业和学期浏览",
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
const sourceOptions = [
  { label: "培养方案", value: "curriculum" },
  { label: "执行教学计划", value: "execution" },
] satisfies Array<{ label: string; value: CoursePlanSourceKind }>;
const materialOptions = [
  { label: "全部课程", value: "all" },
  { label: "已有资料", value: "available" },
  { label: "待补充资料", value: "missing" },
] satisfies Array<{ label: string; value: MaterialFilter }>;

const availableSources = sourceOptions.filter((option) =>
  catalog.plans.some((plan) => plan.sourceKind === option.value),
);
const mode = ref<ViewMode>("plan");
const selectedSource = ref<CoursePlanSourceKind>(
  availableSources[0]?.value ?? "curriculum",
);
const selectedPlanIdentity = ref("");
const selectedDepartment = ref("");
const selectedPlanId = ref("");
const selectedTerm = ref("all");
const keyword = ref("");
const offeringCollege = ref("");
const trainingSchool = ref("");
const searchTerm = ref("");
const materialFilter = ref<MaterialFilter>("all");
const resultLimit = ref(48);
const planRecords = ref<CourseCatalogOccurrence[]>([]);
const planLoading = ref(false);
const planError = ref("");
const planReload = ref(0);

const courseByCode = new Map(
  catalog.courses.map((course) => [course.code, course]),
);
const sourcePlans = computed(() =>
  catalog.plans.filter((plan) => plan.sourceKind === selectedSource.value),
);
const identityOptions = computed(() => {
  const values = Array.from(
    new Set(
      sourcePlans.value.map((plan) =>
        selectedSource.value === "execution"
          ? plan.entryCohort
          : plan.planVersion,
      ),
    ),
  ).sort((a, b) => b.localeCompare(a, "zh-CN"));
  return values.map((value) => ({
    label: value
      ? selectedSource.value === "execution"
        ? `${value} 级`
        : value
      : selectedSource.value === "execution"
        ? "入学年级未标注"
        : "方案版本未标注",
    value,
  }));
});
const scopedPlans = computed(() =>
  sourcePlans.value.filter((plan) => {
    const identity =
      plan.sourceKind === "execution" ? plan.entryCohort : plan.planVersion;
    return identity === selectedPlanIdentity.value;
  }),
);
const schoolSelectOptions = computed(() =>
  Array.from(
    new Map(
      scopedPlans.value.map((plan) => {
        const value = `${plan.departmentCode}\0${plan.school}`;
        const label = [plan.school || "培养学院未标注", plan.departmentCode]
          .filter(Boolean)
          .join(" · ");
        return [value, { label, value }];
      }),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
);
const majorOptions = computed(() =>
  scopedPlans.value
    .filter(
      (plan) =>
        `${plan.departmentCode}\0${plan.school}` === selectedDepartment.value,
    )
    .sort(
      (a, b) =>
        (a.majorFullName || a.majorName).localeCompare(
          b.majorFullName || b.majorName,
          "zh-CN",
        ) || a.majorCode.localeCompare(b.majorCode),
    ),
);
const majorSelectOptions = computed(() =>
  majorOptions.value.map((plan) => ({
    label: [
      plan.majorFullName || plan.majorName || "专业名称未标注",
      plan.programType,
      plan.majorCode,
    ]
      .filter(Boolean)
      .join(" · "),
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
      const courses = planRecords.value
        .filter((occurrence) => occurrence.term === term)
        .flatMap((occurrence): PlanCourseCard[] => {
          const course = courseByCode.get(occurrence.courseCode);
          return course ? [{ course, occurrence }] : [];
        })
        .sort(
          (a, b) =>
            Number(b.course.hasMaterial) - Number(a.course.hasMaterial) ||
            a.course.name.localeCompare(b.course.name, "zh-CN") ||
            a.occurrence.id.localeCompare(b.occurrence.id),
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
    if (searchTerm.value && !course.terms.includes(searchTerm.value)) return false;
    if (materialFilter.value === "available" && !course.hasMaterial) return false;
    if (materialFilter.value === "missing" && course.hasMaterial) return false;
    return true;
  }),
);
const visibleCourses = computed(() =>
  filteredCourses.value.slice(0, resultLimit.value),
);

watch(selectedSource, () => {
  selectedPlanIdentity.value = identityOptions.value[0]?.value ?? "";
  selectedDepartment.value = "";
  selectedPlanId.value = "";
  selectedTerm.value = "all";
});
watch(selectedPlanIdentity, () => {
  selectedDepartment.value = "";
  selectedPlanId.value = "";
  selectedTerm.value = "all";
});
watch(selectedDepartment, () => {
  selectedPlanId.value = "";
  selectedTerm.value = "all";
});
watch([selectedPlanId, planReload], async ([planId], _previous, onCleanup) => {
  selectedTerm.value = "all";
  planRecords.value = [];
  planError.value = "";
  planLoading.value = false;
  if (!planId) return;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  planLoading.value = true;
  try {
    const payload = await loadCoursePlan(planId, catalog.planFiles[planId] ?? "", controller.signal);
    if (!controller.signal.aborted) planRecords.value = payload.occurrences;
  } catch (error) {
    if (!controller.signal.aborted) {
      planError.value = error instanceof Error ? error.message : "课程安排加载失败，请重试。";
    }
  } finally {
    if (!controller.signal.aborted) planLoading.value = false;
  }
});
watch(
  [keyword, offeringCollege, trainingSchool, searchTerm, materialFilter],
  () => {
    resultLimit.value = 48;
  },
);
selectedPlanIdentity.value = identityOptions.value[0]?.value ?? "";

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
const sectionLabels: Record<string, string> = {
  "curriculum-main": "培养方案课程",
  "curriculum-requirements": "培养要求",
  "execution-main": "执行教学计划课程",
  "execution-module": "模块课程要求",
  "execution-double-degree-minor": "双学位与辅修要求",
};
const sourceSectionLabel = (occurrence: CourseCatalogOccurrence) => [
  sectionLabels[occurrence.sourceSection ?? ""] ?? "安排来源未标注",
  occurrence.moduleId ? `模块：${occurrence.moduleId}` : "",
  occurrence.directionKey && occurrence.directionKey !== "0" ? `方向：${occurrence.directionKey}` : "",
].filter(Boolean).join(" · ");
const offeringCollegeOptions = computed(() =>
  catalog.offeringColleges.map((college) => ({ label: college, value: college })),
);
const trainingSchoolOptions = computed(() =>
  catalog.schools.map((school) => ({ label: school, value: school })),
);
const searchTermOptions = computed(() =>
  catalog.terms.map((term) => ({ label: readableTerm(term), value: term })),
);
</script>

<template>
  <main class="course-explorer">
    <section class="catalog-hero">
      <div>
        <p class="catalog-eyebrow">薪火课程中心</p>
        <h1>先找到这学期，再找到这门课</h1>
        <p class="catalog-lead">
          按培养方案或执行教学计划浏览课程路径，或直接按学院、课程名和资料状态检索。
        </p>
      </div>
      <dl class="catalog-stats" aria-label="课程目录统计">
        <div>
          <dt>{{ catalog.plans.length }}</dt>
          <dd>教学计划</dd>
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
      size="small"
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

    <Card v-if="mode === 'plan'" class="catalog-panel plan-panel">
      <template #title>
        <span class="panel-title">
          <span class="step-number">1</span>
          选择教学计划
        </span>
      </template>
      <template #subtitle>选择会逐级缩小，专业选项包含官方代码。</template>
      <template #content>
        <div class="selector-grid">
          <label>
            <span>来源</span>
            <Select
              v-model="selectedSource"
              :options="availableSources"
              option-label="label"
              option-value="value"
              size="small"
              fluid
            />
          </label>
          <label>
            <span>{{ selectedSource === "execution" ? "入学年级" : "方案版本" }}</span>
            <Select
              v-model="selectedPlanIdentity"
              :options="identityOptions"
              option-label="label"
              option-value="value"
              size="small"
              fluid
            />
          </label>
          <label>
            <span>培养学院</span>
            <Select
              v-model="selectedDepartment"
              :options="schoolSelectOptions"
              option-label="label"
              option-value="value"
              size="small"
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
              size="small"
              placeholder="请选择专业"
              :disabled="!selectedDepartment"
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
                <p>
                  {{ selectedPlan.majorFullName || selectedPlan.majorName }} ·
                  {{ selectedPlan.majorCode }} ·
                  {{ selectedPlan.sourceKind === "execution"
                    ? selectedPlan.entryCohort ? `${selectedPlan.entryCohort} 级` : "入学年级未标注"
                    : selectedPlan.planVersion || "方案版本未标注" }}
                </p>
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
              size="small"
              :allow-empty="false"
              aria-label="选择学期"
            />
          </div>

          <Message v-if="planLoading" severity="secondary" role="status">正在加载课程安排…</Message>
          <Message v-else-if="planError" severity="error" role="alert">
            {{ planError }}
            <Button label="重试" size="small" @click="planReload++" />
          </Message>
          <Message v-else-if="!planRecords.length" severity="secondary">教务尚未返回课程安排</Message>
          <Message v-else-if="!planGroups.length" severity="secondary">本学期暂无课程安排。</Message>
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
                  :key="item.occurrence.id"
                  class="course-card"
                  :href="courseLink(item.course.code)"
                >
                  <div class="card-topline">
                    <span class="course-code">{{ item.course.code }}</span>
                    <Tag
                      :value="item.course.hasMaterial ? '有资料' : '待补充'"
                      :severity="
                        item.course.hasMaterial ? 'success' : 'secondary'
                      "
                      size="small"
                      rounded
                    />
                  </div>
                  <h4>{{ item.course.name }}</h4>
                  <p v-if="item.course.name === item.course.code" class="course-college">教务未提供名称</p>
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
                  <p v-if="sourceSectionLabel(item.occurrence)" class="course-college">
                    {{ sourceSectionLabel(item.occurrence) }}
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

        <Message v-else severity="secondary" variant="simple">
          从上面选好来源、版本或年级、学院和专业；课程会自动按学期分组展示。
        </Message>
      </template>
    </Card>

    <Card v-else class="catalog-panel search-panel">
      <template #title>
        <span class="panel-title">
          <i class="pi pi-search" aria-hidden="true" />
          直接检索一门课程
        </span>
      </template>
      <template #subtitle>多个条件可以组合；全部留空时展示完整目录。</template>
      <template #content>
        <IconField class="search-box">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="keyword"
            type="search"
            placeholder="输入课程名称或课程代码"
            size="small"
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
              size="small"
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
              size="small"
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
              size="small"
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
              size="small"
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
                size="small"
                rounded
              />
            </div>
            <h3>{{ course.name }}</h3>
            <p v-if="course.name === course.code" class="course-college">教务未提供名称</p>
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
        <Message v-else severity="secondary" variant="simple">
          没有找到符合条件的课程，请减少筛选条件。
        </Message>
        <Button
          v-if="visibleCourses.length < filteredCourses.length"
          class="load-more"
          label="再显示 48 门"
          icon="pi pi-plus"
          variant="outlined"
          size="small"
          rounded
          @click="resultLimit += 48"
        />
      </template>
    </Card>
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
}
.mode-switch :deep(.p-togglebutton) {
  flex: 1 1 0;
  justify-content: flex-start;
  text-align: left;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.mode-option strong,
.mode-option small {
  display: block;
}
.mode-option small {
  color: var(--vp-c-text-3);
}
.mode-icon {
  color: var(--vp-c-brand-1);
}
.catalog-panel {
  margin-top: 1rem;
}

.panel-heading {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1rem;
}
.panel-heading > div,
.term-toolbar > div:first-child {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
}

.filter-grid {
  grid-template-columns: repeat(4, 1fr);
}
label > span {
  display: block;
  margin-bottom: 0.25rem;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 700;
}

.term-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  margin-top: 1rem;
}
.term-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.term-group {
  margin-top: 1rem;
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
  gap: 0.75rem;
}
.course-card {
  position: relative;
  display: flex;
  min-height: 150px;
  flex-direction: column;
  padding: 0.875rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--p-content-border-radius);
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
  margin: 0.5rem 0 0.25rem;
  border: 0;
  font-size: 16px;
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
  margin: 0.375rem 0 0.5rem;
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.5;
}
.resource-summary {
  margin-top: auto;
  padding-top: 0.5rem;
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
  margin-bottom: 0.75rem;
}
.search-box :deep(.p-inputicon) {
  color: var(--vp-c-text-3);
}
.result-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 1rem 0 0.5rem;
  color: var(--vp-c-text-2);
}
.result-heading strong {
  color: var(--vp-c-text-1);
  font-size: 20px;
}
.search-results {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.load-more {
  display: flex;
  margin: 1rem auto 0;
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
  .selector-grid {
    grid-template-columns: repeat(2, 1fr);
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
