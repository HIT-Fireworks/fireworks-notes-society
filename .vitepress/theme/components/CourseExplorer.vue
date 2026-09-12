<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Message from "primevue/message";
import Button from "primevue/button";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
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

interface PlanCourseEntry {
  course: CourseCatalogCourse;
  occurrence: CourseCatalogOccurrence;
}
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
const mode = ref<ViewMode>("search");
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
const filtersOpen = ref(false);
const resultLimit = ref(48);
const planRecords = ref<CourseCatalogOccurrence[]>([]);
const planLoading = ref(false);
const planError = ref("");
const planReload = ref(0);

function navigateModes(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  mode.value =
    event.key === "Home"
      ? "search"
      : event.key === "End"
        ? "plan"
        : mode.value === "search"
          ? "plan"
          : "search";
  document.getElementById(`course-mode-${mode.value}`)?.focus();
}

const courseByCode = new Map(
  catalog.courses.map((course) => [course.code, course]),
);
const materialCourseCount = computed(() =>
  catalog.courses.reduce(
    (count, course) => count + Number(course.hasMaterial),
    0,
  ),
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
        .flatMap((occurrence): PlanCourseEntry[] => {
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
    if (searchTerm.value && !course.terms.includes(searchTerm.value))
      return false;
    if (materialFilter.value === "available" && !course.hasMaterial)
      return false;
    if (materialFilter.value === "missing" && course.hasMaterial) return false;
    return true;
  }),
);
const visibleCourses = computed(() =>
  filteredCourses.value.slice(0, resultLimit.value),
);
const additionalFilterCount = computed(
  () =>
    [offeringCollege.value, trainingSchool.value, searchTerm.value].filter(
      Boolean,
    ).length,
);
const hasSearchFilters = computed(() =>
  Boolean(
    keyword.value ||
    additionalFilterCount.value ||
    materialFilter.value !== "all",
  ),
);
const clearSearch = () => {
  keyword.value = "";
  offeringCollege.value = "";
  trainingSchool.value = "";
  searchTerm.value = "";
  materialFilter.value = "all";
};

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
    const payload = await loadCoursePlan(
      planId,
      catalog.planFiles[planId] ?? "",
      controller.signal,
    );
    if (!controller.signal.aborted) planRecords.value = payload.occurrences;
  } catch (error) {
    if (!controller.signal.aborted) {
      planError.value =
        error instanceof Error ? error.message : "课程安排加载失败，请重试。";
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
const sourceSectionLabel = (occurrence: CourseCatalogOccurrence) =>
  [
    sectionLabels[occurrence.sourceSection ?? ""] ?? "安排来源未标注",
    occurrence.moduleId ? `模块：${occurrence.moduleId}` : "",
    occurrence.directionKey && occurrence.directionKey !== "0"
      ? `方向：${occurrence.directionKey}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
  catalog.terms.map((term) => ({ label: readableTerm(term), value: term })),
);
</script>

<template>
  <main class="course-explorer">
    <header class="catalog-heading">
      <div class="heading-copy">
        <h1>课程中心</h1>
        <p>查找课程、课堂笔记与复习资料。</p>
      </div>
      <dl class="catalog-overview" aria-label="课程目录概览">
        <div class="overview-item overview-primary">
          <dt>已有资料</dt>
          <dd>
            {{ materialCourseCount.toLocaleString("zh-CN") }}<span>门</span>
          </dd>
        </div>
        <div class="overview-item">
          <dt>收录课程</dt>
          <dd>
            {{ catalog.courses.length.toLocaleString("zh-CN") }}<span>门</span>
          </dd>
        </div>
        <div class="overview-item">
          <dt>教学计划</dt>
          <dd>
            {{ catalog.plans.length.toLocaleString("zh-CN") }}<span>份</span>
          </dd>
        </div>
      </dl>
    </header>

    <div
      class="mode-nav"
      role="tablist"
      aria-label="课程浏览方式"
      @keydown="navigateModes"
    >
      <button
        id="course-mode-search"
        type="button"
        class="mode-tab"
        role="tab"
        :aria-selected="mode === 'search'"
        :tabindex="mode === 'search' ? 0 : -1"
        aria-controls="course-search-panel"
        @click="mode = 'search'"
      >
        找课程
      </button>
      <button
        id="course-mode-plan"
        type="button"
        class="mode-tab"
        role="tab"
        :aria-selected="mode === 'plan'"
        :tabindex="mode === 'plan' ? 0 : -1"
        aria-controls="course-plan-panel"
        @click="mode = 'plan'"
      >
        按教学计划
      </button>
    </div>

    <section
      v-show="mode === 'search'"
      id="course-search-panel"
      class="catalog-view"
      role="tabpanel"
      aria-labelledby="course-mode-search"
    >
      <div class="search-toolbar">
        <IconField class="search-box">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="keyword"
            type="search"
            aria-label="搜索课程名称或代码"
            placeholder="搜索课程名称或代码"
            fluid
          />
        </IconField>
        <Select
          v-model="materialFilter"
          class="material-select"
          :options="materialOptions"
          option-label="label"
          option-value="value"
          aria-label="资料状态"
        />
        <button
          type="button"
          class="filter-toggle"
          :aria-expanded="filtersOpen"
          aria-controls="course-filters"
          @click="filtersOpen = !filtersOpen"
        >
          <i class="pi pi-sliders-h" aria-hidden="true" />
          筛选<span v-if="additionalFilterCount" class="filter-count">{{
            additionalFilterCount
          }}</span>
          <i
            :class="['pi', filtersOpen ? 'pi-angle-up' : 'pi-angle-down']"
            aria-hidden="true"
          />
        </button>
      </div>

      <div v-show="filtersOpen" id="course-filters" class="filter-grid">
        <label>
          <span>开课学院</span>
          <Select
            v-model="offeringCollege"
            :options="[
              { label: '全部开课学院', value: '' },
              ...offeringCollegeOptions,
            ]"
            option-label="label"
            option-value="value"
            aria-label="开课学院"
            filter
            fluid
          />
        </label>
        <label>
          <span>培养学院</span>
          <Select
            v-model="trainingSchool"
            :options="[
              { label: '全部培养学院', value: '' },
              ...trainingSchoolOptions,
            ]"
            option-label="label"
            option-value="value"
            aria-label="培养学院筛选"
            filter
            fluid
          />
        </label>
        <label>
          <span>推荐学期</span>
          <Select
            v-model="searchTerm"
            :options="[{ label: '全部学期', value: '' }, ...searchTermOptions]"
            option-label="label"
            option-value="value"
            aria-label="推荐学期"
            fluid
          />
        </label>
      </div>

      <div class="result-heading">
        <p role="status" aria-live="polite" aria-atomic="true">
          <strong>{{ filteredCourses.length.toLocaleString("zh-CN") }}</strong>
          门课程
        </p>
        <button
          v-if="hasSearchFilters"
          type="button"
          class="text-button"
          @click="clearSearch"
        >
          清除筛选
        </button>
      </div>

      <ul
        v-if="visibleCourses.length"
        class="course-grid"
        aria-label="课程列表"
      >
        <li v-for="course in visibleCourses" :key="course.code">
          <a
            class="course-card"
            :class="{ 'has-resources': course.hasMaterial }"
            :href="courseLink(course.code)"
          >
            <div class="course-card-body">
              <div class="course-card-heading">
                <span class="course-card-symbol" aria-hidden="true"
                  ><i class="pi pi-book"
                /></span>
                <div>
                  <h2>{{ course.name }}</h2>
                  <span class="course-code">{{ course.code }}</span>
                </div>
              </div>
              <p v-if="course.name === course.code" class="course-card-note">
                教务未提供名称
              </p>
              <div class="course-card-meta">
                <p>
                  <i class="pi pi-building-columns" aria-hidden="true" />
                  <span>{{
                    course.offeringColleges.slice(0, 2).join("、") ||
                    "开课学院未标注"
                  }}</span>
                </p>
                <p
                  v-if="course.terms.length"
                  :title="course.terms.map(readableTerm).join('、')"
                >
                  <i class="pi pi-calendar" aria-hidden="true" />
                  <span
                    >{{ course.terms.slice(0, 2).map(readableTerm).join("、")
                    }}<span v-if="course.terms.length > 2">
                      等 {{ course.terms.length }} 个学期</span
                    ></span
                  >
                </p>
              </div>
            </div>
            <div class="course-card-footer">
              <div class="course-card-resources">
                <span class="material-indicator">
                  {{
                    course.hasMaterial
                      ? `${course.fileCount} 个文件`
                      : "暂无资料"
                  }}
                </span>
                <span v-if="course.hasMaterial" class="course-card-size">{{
                  readableBytes(course.bytes)
                }}</span>
              </div>
              <span class="course-card-action"
                >{{ course.hasMaterial ? "查看资料" : "课程详情"
                }}<i class="pi pi-arrow-right" aria-hidden="true"
              /></span>
            </div>
          </a>
        </li>
      </ul>
      <div v-else class="empty-state">
        <strong>没有找到符合条件的课程</strong>
        <p>换个关键词，或清除筛选条件后再试。</p>
        <button type="button" class="text-button" @click="clearSearch">
          查看全部课程
        </button>
      </div>

      <div v-if="visibleCourses.length" class="list-footer">
        <span
          >已显示 {{ visibleCourses.length }} /
          {{ filteredCourses.length.toLocaleString("zh-CN") }} 门课程</span
        >
        <Button
          v-if="visibleCourses.length < filteredCourses.length"
          label="显示更多"
          severity="secondary"
          variant="outlined"
          size="small"
          @click="resultLimit += 48"
        />
      </div>
    </section>

    <section
      v-show="mode === 'plan'"
      id="course-plan-panel"
      class="catalog-view"
      role="tabpanel"
      aria-labelledby="course-mode-plan"
    >
      <div class="plan-guide">
        <i class="pi pi-sitemap" aria-hidden="true" />
        <div>
          <strong>从教学计划进入</strong>
          <span>选择来源、版本或年级、学院和专业后，按学期查看课程安排。</span>
        </div>
      </div>
      <div class="plan-picker">
        <label>
          <span>计划来源</span>
          <Select
            v-model="selectedSource"
            :options="availableSources"
            option-label="label"
            option-value="value"
            aria-label="计划来源"
            fluid
          />
        </label>
        <label>
          <span>{{
            selectedSource === "execution" ? "入学年级" : "方案版本"
          }}</span>
          <Select
            v-model="selectedPlanIdentity"
            :options="identityOptions"
            option-label="label"
            option-value="value"
            :aria-label="
              selectedSource === 'execution' ? '入学年级' : '方案版本'
            "
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
            aria-label="计划培养学院"
            placeholder="选择学院"
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
            aria-label="专业"
            :placeholder="selectedDepartment ? '选择专业' : '请先选择学院'"
            :disabled="!selectedDepartment"
            filter
            fluid
          />
        </label>
      </div>

      <template v-if="selectedPlan">
        <div class="selected-plan-heading">
          <div>
            <h2>
              {{
                selectedPlan.majorFullName ||
                selectedPlan.majorName ||
                "专业名称未标注"
              }}
            </h2>
            <p>
              {{ selectedPlan.school }} ·
              <span class="course-code">{{ selectedPlan.majorCode }}</span>
              <span v-if="selectedPlan.programType">
                · {{ selectedPlan.programType }}</span
              >
              ·
              {{
                selectedPlan.sourceKind === "execution"
                  ? selectedPlan.entryCohort
                    ? `${selectedPlan.entryCohort} 级`
                    : "入学年级未标注"
                  : selectedPlan.planVersion || "方案版本未标注"
              }}
            </p>
          </div>
          <label class="term-control">
            <span>显示学期</span>
            <Select
              v-model="selectedTerm"
              :options="[
                { label: '全部学期', value: 'all' },
                ...selectedPlan.terms.map((term) => ({
                  label: readableTerm(term),
                  value: term,
                })),
              ]"
              option-label="label"
              option-value="value"
              aria-label="显示学期"
              fluid
            />
          </label>
        </div>
        <div :aria-busy="planLoading">
          <Message
            v-if="planLoading"
            severity="secondary"
            variant="simple"
            role="status"
            >正在加载课程安排…</Message
          >
          <Message v-else-if="planError" severity="error" role="alert">
            {{ planError }}
            <Button label="重试" size="small" @click="planReload++" />
          </Message>
          <p v-else-if="!planRecords.length" class="plan-note" role="status">
            教务尚未返回课程安排。
          </p>
          <p v-else-if="!planGroups.length" class="plan-note" role="status">
            本学期暂无课程安排。
          </p>
          <div v-else class="term-groups">
            <section
              v-for="group in planGroups"
              :key="group.term"
              class="term-group"
            >
              <header>
                <h3>{{ readableTerm(group.term) }}</h3>
                <span>{{ group.courses.length }} 条课程安排</span>
              </header>
              <ul
                class="course-grid"
                :aria-label="`${readableTerm(group.term)}课程列表`"
              >
                <li v-for="item in group.courses" :key="item.occurrence.id">
                  <a
                    class="course-card"
                    :class="{ 'has-resources': item.course.hasMaterial }"
                    :href="courseLink(item.course.code)"
                  >
                    <div class="course-card-body">
                      <div class="course-card-heading">
                        <span class="course-card-symbol" aria-hidden="true"
                          ><i class="pi pi-book"
                        /></span>
                        <div>
                          <h4>{{ item.course.name }}</h4>
                          <span class="course-code">{{
                            item.course.code
                          }}</span>
                        </div>
                      </div>
                      <p
                        v-if="item.course.name === item.course.code"
                        class="course-card-note"
                      >
                        教务未提供名称
                      </p>
                      <p
                        v-if="sourceSectionLabel(item.occurrence)"
                        class="course-card-note"
                      >
                        {{ sourceSectionLabel(item.occurrence) }}
                      </p>
                      <div class="course-card-meta">
                        <p>
                          <i
                            class="pi pi-building-columns"
                            aria-hidden="true"
                          />
                          <span>{{
                            item.occurrence.offeringCollege ||
                            item.course.offeringColleges[0] ||
                            "开课学院未标注"
                          }}</span>
                        </p>
                        <p
                          v-if="
                            item.occurrence.credit !== undefined ||
                            item.occurrence.totalHours !== undefined ||
                            item.occurrence.courseNature
                          "
                        >
                          <i class="pi pi-clock" aria-hidden="true" />
                          <span class="course-arrangement">
                            <span v-if="item.occurrence.credit !== undefined"
                              >{{ item.occurrence.credit }} 学分</span
                            >
                            <span
                              v-if="item.occurrence.totalHours !== undefined"
                              >{{ item.occurrence.totalHours }} 学时</span
                            >
                            <span v-if="item.occurrence.courseNature">{{
                              item.occurrence.courseNature
                            }}</span>
                          </span>
                        </p>
                      </div>
                    </div>
                    <div class="course-card-footer">
                      <div class="course-card-resources">
                        <span class="material-indicator">
                          {{
                            item.course.hasMaterial
                              ? `${item.course.fileCount} 个文件`
                              : "暂无资料"
                          }}
                        </span>
                        <span
                          v-if="item.course.hasMaterial"
                          class="course-card-size"
                          >{{ readableBytes(item.course.bytes) }}</span
                        >
                      </div>
                      <span class="course-card-action"
                        >{{ item.course.hasMaterial ? "查看资料" : "课程详情"
                        }}<i class="pi pi-arrow-right" aria-hidden="true"
                      /></span>
                    </div>
                  </a>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </template>
      <div v-else class="empty-state">
        <strong>{{
          selectedDepartment ? "选择专业，查看课程安排" : "从学院和专业开始"
        }}</strong>
        <p>选好后，课程会按学期列在这里。</p>
        <button type="button" class="text-button" @click="mode = 'search'">
          已知课程名称？直接搜索
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.course-explorer {
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 24px 72px;
  color: var(--vp-c-text-1);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.catalog-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 32px;
  margin-bottom: 28px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.catalog-heading h1 {
  margin: 0;
  border: 0;
  font-size: 32px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.02em;
}
.catalog-heading p {
  margin: 8px 0 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
}
.catalog-overview {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 24px;
  flex-shrink: 0;
  margin: 0;
}
.overview-item {
  padding-left: 24px;
  border-left: 1px solid var(--vp-c-divider);
}
.overview-item dt {
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.overview-item dd {
  margin: 6px 0 0;
  color: var(--vp-c-text-1);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.25;
}
.overview-item dd span {
  margin-left: 4px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 400;
}
.overview-primary dd {
  color: var(--vp-c-brand-1);
}
.mode-nav {
  display: flex;
  gap: 4px;
  width: fit-content;
  margin-bottom: 20px;
  padding: 4px;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
.mode-tab {
  min-width: 112px;
  padding: 7px 18px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--vp-c-text-2);
  background: transparent;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.mode-tab[aria-selected="true"] {
  border-color: var(--vp-c-divider);
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--vp-c-text-1) 6%, transparent);
  font-weight: 600;
}
.mode-tab:focus-visible,
.filter-toggle:focus-visible,
.text-button:focus-visible,
.course-card:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
  border-radius: 3px;
}
.catalog-view {
  min-width: 0;
}
.plan-guide {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 18px;
  padding: 11px 14px;
  border-left: 3px solid var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}
.plan-guide > i {
  color: var(--vp-c-brand-1);
  font-size: 16px;
}
.plan-guide > div {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
}
.plan-guide strong {
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 600;
}
.plan-guide span {
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.search-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
}
.search-box {
  flex: 1;
  min-width: 0;
}
.search-box :deep(.p-inputicon) {
  color: var(--vp-c-text-3);
}
.material-select {
  flex: 0 0 130px;
}
.filter-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 7px;
  align-items: center;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  color: var(--vp-c-text-2);
  background: transparent;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.filter-toggle:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}
.filter-count {
  display: inline-grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, var(--vp-c-bg));
  font-size: 11px;
}
.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--vp-c-divider);
}
.filter-grid label,
.plan-picker label,
.term-control {
  min-width: 0;
}
label > span {
  display: block;
  margin-bottom: 4px;
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.result-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: baseline;
  margin: 24px 0 16px;
}
.result-heading p,
.list-footer,
.plan-note {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.result-heading strong {
  color: var(--vp-c-text-1);
  font-size: 20px;
  font-weight: 600;
}
.text-button {
  padding: 0;
  border: 0;
  color: var(--vp-c-brand-1);
  background: transparent;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.text-button:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.course-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.course-grid > li {
  min-width: 0;
  margin: 0;
  padding: 0;
}
.course-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid color-mix(in srgb, var(--vp-c-text-1) 15%, var(--vp-c-bg));
  border-radius: 14px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  text-decoration: none;
  box-shadow: 0 2px 5px color-mix(in srgb, var(--vp-c-text-1) 3%, transparent);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}
.course-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--vp-c-text-1) 8%, transparent);
}
.course-card-body {
  flex: 1;
  min-width: 0;
  padding: 20px;
}
.course-card-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
}
.course-card-heading > div {
  min-width: 0;
}
.course-card-symbol {
  display: grid;
  flex: 0 0 36px;
  width: 36px;
  height: 40px;
  place-items: center;
  border: 1px solid var(--vp-c-divider);
  border-radius: 9px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
}
.has-resources .course-card-symbol {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 18%, var(--vp-c-bg));
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, var(--vp-c-bg));
}
.course-code {
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}
.course-card h2,
.course-card h4 {
  margin: 0 0 5px;
  padding: 0;
  border: 0;
  color: var(--vp-c-text-1);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
}
.course-card-note {
  margin: -6px 0 14px;
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.course-card-meta {
  display: grid;
  gap: 6px;
}
.course-card-meta p {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.6;
}
.course-card-meta > p > i {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.course-arrangement {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
}
.course-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 0 20px;
  padding: 14px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.course-card-resources {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.material-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
.course-card-size {
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.course-card-action {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 7px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 12px;
  font-weight: 500;
}
.course-card.has-resources .course-card-action {
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, var(--vp-c-bg));
}
.course-card-action i {
  font-size: 12px;
  transition: transform 0.18s ease;
}
.course-card:hover .course-card-action i {
  transform: translateX(3px);
}
.list-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding-top: 16px;
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.plan-picker {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.selected-plan-heading {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: end;
  padding: 24px 0 16px;
}
.selected-plan-heading h2 {
  margin: 0 0 3px;
  border: 0;
  font-size: 20px;
  font-weight: 600;
}
.selected-plan-heading p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.term-control {
  flex: 0 0 160px;
}
.term-groups {
  border-top: 1px solid var(--vp-c-divider);
}
.term-group {
  padding-top: 24px;
}
.term-group > header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-bottom: 14px;
}
.term-group h3 {
  margin: 0;
  border: 0;
  font-size: 16px;
  font-weight: 600;
}
.term-group > header > span {
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.plan-note {
  padding: 24px 0;
}
.empty-state {
  padding: 48px 0;
  color: var(--vp-c-text-2);
  text-align: center;
}
.empty-state strong {
  color: var(--vp-c-text-1);
  font-size: 15px;
  font-weight: 500;
}
.empty-state p {
  margin: 5px 0 12px;
  font-size: 13px;
}
@media (prefers-reduced-motion: reduce) {
  .course-card,
  .course-card-action i {
    transition: none;
  }
  .course-card:hover .course-card-action i {
    transform: none;
  }
}
@media (max-width: 960px) {
  .course-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 800px) {
  .catalog-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 24px;
  }
  .catalog-overview {
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .overview-item:first-child {
    padding-left: 0;
    border-left: 0;
  }
  .filter-grid,
  .plan-picker {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .course-explorer {
    padding: 24px 16px 48px;
  }
  .catalog-heading {
    margin-bottom: 22px;
  }
  .catalog-heading h1 {
    font-size: 26px;
  }
  .overview-item {
    padding-left: 16px;
  }
  .overview-item dd {
    font-size: 20px;
  }
  .mode-nav {
    width: 100%;
  }
  .mode-tab {
    flex: 1;
    text-align: center;
  }
  .search-toolbar {
    align-items: stretch;
    flex-wrap: wrap;
  }
  .search-box {
    flex-basis: 100%;
  }
  .material-select {
    flex: 1;
  }
  .filter-toggle {
    flex: 1;
    justify-content: center;
  }
  .filter-grid,
  .plan-picker {
    grid-template-columns: 1fr;
  }
  .result-heading,
  .list-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
  .course-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .course-card-body {
    padding: 18px;
  }
  .course-card-footer {
    margin: 0 18px;
    padding: 12px 0;
  }
  .selected-plan-heading {
    display: block;
    padding-top: 20px;
  }
  .term-control {
    display: block;
    width: 100%;
    margin-top: 16px;
  }
}
</style>
