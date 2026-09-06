"""Seeds a realistic demo dataset for the Ethiopian Environmental Protection Authority (EPA).

Idempotent: re-running clears and rebuilds all tables.

Run with:  python3 seed.py
Login accounts use `PMS_DEMO_PASSWORD` when provided. Local development
generates a random password and prints it after seeding:
  admin1     -> admin        (Rediat Amare, HR Director)
  exec1      -> executive    (Dr. Lelise Neme, Director General)
  director1  -> director     (Ato Tesfaye Girma, Director - Env. Regulatory)
  director2  -> director     (W/ro Hirut Bekele, Director - Env. System Establishment)
  depthead1  -> dept_head    (W/ro Lemnedework Abebe, Director - Policy & International Affairs)
  lead1      -> team_leader  (Ato Solomon Girma, ESIA Review Team)
  lead2      -> team_leader  (Ato Leul Kassa, Inspection Team)
  lead3      -> team_leader  (Ato Endalkachew Shiferaw, MRV & Reporting Team)
  employee1  -> employee     (Ato Dawit Mekonnen, Senior ESIA Expert)
  employee2  -> employee     (W/ro Fatuma Ahmed, Environmental Inspector)
  employee3  -> employee     (Ato Bereket Tesfa, Climate Change Specialist)
  employee4  -> employee     (W/ro Sara Tadesse, ICT Officer)

Demo dataset covers the Phase 0 enterprise foundation:
  - EPA organizational hierarchy: Authority -> Directorates -> Departments -> Teams
  - Positions, reporting relationships (primary/functional/acting) and org history
  - RBAC: roles, permissions, role_permissions, users.role_id
  - Generic approval workflows (evaluation + goal) and sample notifications
"""

import json
import os
import secrets
from datetime import date, datetime, timedelta

from database import init_db, get_db
from auth import hash_password


DEMO_PASSWORD = os.environ.get("PMS_DEMO_PASSWORD")
if not DEMO_PASSWORD:
    if os.environ.get("PMS_ENV") == "production":
        raise RuntimeError("PMS_DEMO_PASSWORD must be set before seeding production")
    DEMO_PASSWORD = secrets.token_urlsafe(12)


def run():
    db = get_db()
    # Idempotent rebuild — drop everything so re-seeding always produces a clean DB.
    # Disable FK checks during teardown to avoid cascade ordering issues.
    db.execute("PRAGMA foreign_keys = OFF")
    # Order matters: children must be dropped before the parents they reference.
    tables = [
        "evaluation_acknowledgements", "evaluation_template_versions",
        "approval_actions", "notifications", "delegations",
        "employee_org_history", "reporting_relationships", "role_permissions",
        "users", "evaluation_assignments", "evaluation_answers",
        "evaluation_approvals", "evaluation_form_questions",
        "evaluation_form_sections", "evaluation_forms", "evaluations",
        "ai_insights", "performance_scores", "goals", "kpis",
        "employee_competencies", "competencies", "score_weights",
        "rating_bands", "performance_cycles", "audit_log",
        "approval_requests", "workflow_steps", "workflow_definitions",
        "employees", "positions", "departments", "org_unit_types",
        "permissions", "roles", "schema_migrations",
        "settings", "relationship_types", "competency_categories",
        "demo_accounts", "navigation_items",
        "activity_progress_logs", "activity_kpis",
        "program_activities", "programs",
        "weekly_tasks", "weekly_plans", "strategic_goal_kpis", "strategic_goals",
    ]
    for t in tables:
        db.execute(f"DROP TABLE IF EXISTS {t}")
    db.commit()
    db.close()

    init_db()
    db = get_db()
    db.execute("PRAGMA foreign_keys = ON")

    today = date.today()

    # ---------------- Organization ----------------
    # EPA hierarchy: Authority -> Directorate -> Department -> Team
    def unit_type(name, order):
        db.execute(
            "INSERT INTO org_unit_types (name, level_order, system_default) VALUES (?,?,1)",
            (name, order),
        )
        return db.execute("SELECT id FROM org_unit_types WHERE name=?", (name,)).fetchone()["id"]

    ut_authority = unit_type("Authority", 0)
    ut_directorate = unit_type("Directorate", 1)
    ut_department = unit_type("Department", 2)
    ut_team = unit_type("Team", 3)

    def dept(name, unit_type_id, parent_id=None, code=None):
        db.execute(
            "INSERT INTO departments (name, unit_type_id, parent_id, code) VALUES (?,?,?,?)",
            (name, unit_type_id, parent_id, code),
        )
        return db.execute("SELECT id FROM departments WHERE name=?", (name,)).fetchone()["id"]

    # Level 0: Authority (root)
    authority_id = dept("Ethiopian Environmental Protection Authority", ut_authority)

    # Level 1: Directorates
    regulatory_id = dept("Environmental Regulatory Sector", ut_directorate, authority_id, "ERG")
    env_sys_id = dept("Environmental System Establishment", ut_directorate, authority_id, "ESE")
    corporate_id = dept("Corporate Services", ut_directorate, authority_id, "CS")
    dg_office_id = dept("Office of the Director General", ut_directorate, authority_id, "ODG")

    # Level 2: Departments under Environmental Regulatory Sector
    esia_id = dept("Environmental & Social Impact Assessment", ut_department, regulatory_id, "ESIA")
    compliance_id = dept("Compliance & Enforcement", ut_department, regulatory_id, "C&E")
    biosafety_id = dept("Biosafety & Ecosystem Regulation", ut_department, regulatory_id, "BER")

    # Level 2: Departments under Environmental System Establishment
    climate_id = dept("Climate Change Response", ut_department, env_sys_id, "CCR")
    pollution_id = dept("Pollution Control & Monitoring", ut_department, env_sys_id, "PCM")
    env_info_id = dept("Environmental Information Management", ut_department, env_sys_id, "EIM")

    # Level 2: Departments under Corporate Services
    hr_id = dept("Human Resources", ut_department, corporate_id, "HR")
    finance_id = dept("Finance & Administration", ut_department, corporate_id, "FIN")
    procurement_id = dept("Procurement", ut_department, corporate_id, "PROC")
    ict_id = dept("Information & Communication Technology", ut_department, corporate_id, "ICT")

    # Level 2: Department under DG Office
    policy_id = dept("Policy & International Affairs", ut_department, dg_office_id, "PIA")

    # Level 3: Teams under ESIA
    esia_review_id = dept("ESIA Review Team", ut_team, esia_id, "ESIA-RT")
    eia_licensing_id = dept("EIA Licensing Team", ut_team, esia_id, "EIA-LT")

    # Level 3: Teams under Compliance & Enforcement
    inspection_id = dept("Inspection Team", ut_team, compliance_id, "INS-T")
    enforcement_id = dept("Enforcement Team", ut_team, compliance_id, "ENF-T")

    # Level 3: Teams under Biosafety
    biosafety_team_id = dept("Biosafety Review Team", ut_team, biosafety_id, "BIO-T")

    # Level 3: Teams under Climate Change Response
    mrv_id = dept("MRV & Reporting Team", ut_team, climate_id, "MRV-T")
    adaptation_id = dept("Adaptation Planning Team", ut_team, climate_id, "ADP-T")

    # Level 3: Teams under Pollution Control
    monitoring_id = dept("Air & Water Quality Monitoring Team", ut_team, pollution_id, "AWQ-T")

    # Level 3: Teams under Environmental Information
    data_mgmt_id = dept("Data Management Team", ut_team, env_info_id, "DMG-T")

    # Level 3: Teams for departments whose staff must sit inside a team
    pollution_mon_id = dept("Pollution Monitoring Team", ut_team, pollution_id, "POLL-T")
    ict_support_id = dept("ICT Support Team", ut_team, ict_id, "ICT-S")
    hr_ops_id = dept("HR Operations Team", ut_team, hr_id, "HR-OPS")
    proc_team_id = dept("Procurement Team", ut_team, procurement_id, "PROC-T")
    fin_ops_id = dept("Finance Operations Team", ut_team, finance_id, "FIN-OPS")
    policy_team_id = dept("Policy Analysis Team", ut_team, policy_id, "PIA-T")
    dg_sec_id = dept("DG Secretariat Team", ut_team, dg_office_id, "ODG-S")

    # ---------------- Positions ----------------
    def position(title, grade, unit_id, is_head=0):
        db.execute(
            "INSERT INTO positions (title, job_grade, org_unit_id, is_head) VALUES (?,?,?,?)",
            (title, grade, unit_id, is_head),
        )
        return db.execute(
            "SELECT id FROM positions WHERE title=? AND org_unit_id=?",
            (title, unit_id)).fetchone()["id"]

    pos_dg = position("Director General", "G12", authority_id, 1)
    pos_ddg_reg = position("Deputy DG - Regulatory Affairs", "G11", regulatory_id, 1)
    pos_ddg_sys = position("Deputy DG - Environmental Systems", "G11", env_sys_id, 1)
    pos_reg_dir = position("Director - Environmental Regulatory", "G10", regulatory_id, 1)
    pos_sys_dir = position("Director - Environmental System Establishment", "G10", env_sys_id, 1)
    pos_corp_dir = position("Director - Corporate Services", "G10", corporate_id, 1)
    pos_dg_secretary = position("DG Secretary", "G8", dg_office_id, 1)
    pos_esia_dir = position("Director - ESIA", "G9", esia_id, 1)
    pos_compliance_dir = position("Director - Compliance & Enforcement", "G9", compliance_id, 1)
    pos_bio_dir = position("Director - Biosafety", "G9", biosafety_id, 1)
    pos_climate_dir = position("Director - Climate Change Response", "G9", climate_id, 1)
    pos_pollution_dir = position("Director - Pollution Control", "G9", pollution_id, 1)
    pos_info_dir = position("Director - Environmental Information", "G9", env_info_id, 1)
    pos_hr_dir = position("HR Director", "G9", hr_id, 1)
    pos_finance_dir = position("Finance Director", "G9", finance_id, 1)
    pos_proc_dir = position("Procurement Director", "G9", procurement_id, 1)
    pos_ict_dir = position("ICT Director", "G9", ict_id, 1)
    pos_policy_dir = position("Director - Policy & International Affairs", "G9", policy_id, 1)

    # Team leader positions (level 3)
    pos_esia_lead = position("Team Leader - ESIA Review", "G8", esia_review_id, 1)
    pos_inspection_lead = position("Team Leader - Inspection", "G8", inspection_id, 1)
    pos_enforcement_lead = position("Team Leader - Enforcement", "G8", enforcement_id, 1)
    pos_eia_licensing_lead = position("Team Leader - EIA Licensing", "G8", eia_licensing_id, 1)
    pos_biosafety_lead = position("Team Leader - Biosafety", "G8", biosafety_team_id, 1)
    pos_mrv_lead = position("Team Leader - MRV & Reporting", "G8", mrv_id, 1)
    pos_adaptation_lead = position("Team Leader - Adaptation", "G8", adaptation_id, 1)
    pos_monitoring_lead = position("Team Leader - Monitoring", "G8", monitoring_id, 1)
    pos_data_mgmt_lead = position("Team Leader - Data Management", "G8", data_mgmt_id, 1)

    # Team leader positions for the new teams (within their teams)
    pos_pollution_mon_lead = position("Team Leader - Pollution Monitoring", "G8", pollution_mon_id, 1)
    pos_ict_lead = position("Team Leader - ICT Support", "G8", ict_support_id, 1)
    pos_hr_lead = position("Team Leader - HR Operations", "G8", hr_ops_id, 1)
    pos_proc_lead = position("Team Leader - Procurement", "G8", proc_team_id, 1)
    pos_fin_lead = position("Team Leader - Finance Operations", "G8", fin_ops_id, 1)
    pos_policy_lead = position("Team Leader - Policy Analysis", "G8", policy_team_id, 1)
    pos_dg_sec_lead = position("Team Leader - DG Secretariat", "G8", dg_sec_id, 1)

    # Staff positions
    pos_senior_esia = position("Senior ESIA Expert", "G7", esia_review_id)
    pos_esia_expert = position("ESIA Expert", "G6", esia_review_id)
    pos_inspector = position("Environmental Inspector", "G7", inspection_id)
    pos_senior_inspector = position("Senior Environmental Inspector", "G8", inspection_id)
    pos_enforcement_officer = position("Enforcement Officer", "G6", enforcement_id)
    pos_biosafety_officer = position("Biosafety Officer", "G7", biosafety_team_id)
    pos_climate_spec = position("Climate Change Specialist", "G7", mrv_id)
    pos_adaptation_spec = position("Adaptation Planning Specialist", "G6", adaptation_id)
    pos_monitoring_eng = position("Environmental Monitoring Engineer", "G7", monitoring_id)
    pos_air_quality_spec = position("Air Quality Specialist", "G6", monitoring_id)
    pos_data_analyst = position("Environmental Data Analyst", "G6", data_mgmt_id)
    pos_ict_officer = position("ICT Officer", "G6", ict_id)
    pos_hris_spec = position("HRIS Specialist", "G6", hr_id)
    pos_procurement_officer = position("Procurement Officer", "G6", procurement_id)
    pos_budget_officer = position("Budget & Finance Officer", "G6", finance_id)
    pos_policy_advocate = position("Policy Analyst", "G7", policy_id)
    pos_mea_coord = position("MEAs Coordination Officer", "G6", policy_id)
    pos_eia_licensing = position("EIA Licensing Officer", "G6", eia_licensing_id)
    pos_electronic_wr = position("E-Waste Management Specialist", "G6", pollution_id)

    # ---------------- Performance cycles ----------------
    def cycle(name, start_off, end_off, status):
        db.execute(
            "INSERT INTO performance_cycles (name, start_date, end_date, status) VALUES (?,?,?,?)",
            (name, (today - timedelta(days=start_off)).isoformat(), (today - timedelta(days=end_off)).isoformat(), status),
        )
        return db.execute("SELECT id FROM performance_cycles WHERE name=?", (name,)).fetchone()["id"]

    past_cycle_id = cycle("H1 2026", 230, 90, "closed")
    cycle_id = cycle("H2 2026", 45, -45, "active")

    # ---------------- Employees ----------------
    def emp(name, email, position, grade, dept_id, manager_id=None, joined=700, position_id=None):
        db.execute(
            "INSERT INTO employees (full_name, email, position, job_grade, department_id, manager_id, "
            "date_joined, position_id) VALUES (?,?,?,?,?,?,?,?)",
            (name, email, position, grade, dept_id, manager_id,
             (today - timedelta(days=joined)).isoformat(), position_id),
        )
        return db.execute("SELECT id FROM employees WHERE email=?", (email,)).fetchone()["id"]

    # Director General
    lelise_id = emp("Dr. Lelise Neme", "lelise.neme@epa.gov.et", "Director General", "G12",
                    authority_id, position_id=pos_dg, joined=1500)

    # Directors
    rediat_id = emp("Rediat Amare", "rediat.amare@epa.gov.et", "HR Director", "G9",
                    hr_id, lelise_id, position_id=pos_hr_dir, joined=1200)
    tesfaye_id = emp("Ato Tesfaye Girma", "tesfaye.girma@epa.gov.et", "Director - Environmental Regulatory",
                     "G10", regulatory_id, lelise_id, position_id=pos_reg_dir, joined=1100)
    hirut_id = emp("W/ro Hirut Bekele", "hirut.bekele@epa.gov.et",
                   "Director - Environmental System Establishment", "G10",
                   env_sys_id, lelise_id, position_id=pos_sys_dir, joined=1000)
    getachew_id = emp("Ato Getachew Weldu", "getachew.weldu@epa.gov.et", "Director - Corporate Services",
                      "G10", corporate_id, lelise_id, position_id=pos_corp_dir, joined=900)

    # Team Leaders (level 3) - Environmental Regulatory Sector
    solomon_id = emp("Ato Solomon Girma", "solomon.girma@epa.gov.et", "Team Leader - ESIA Review", "G8",
                     esia_review_id, tesfaye_id, position_id=pos_esia_lead, joined=750)
    leul_id = emp("Ato Leul Kassa", "leul.kassa@epa.gov.et", "Team Leader - Inspection", "G8",
                  inspection_id, tesfaye_id, position_id=pos_inspection_lead, joined=720)
    meseret_id = emp("W/ro Meseret Alemu", "meseret.alemu@epa.gov.et", "Team Leader - Enforcement", "G8",
                     enforcement_id, tesfaye_id, position_id=pos_enforcement_lead, joined=700)

    # Team Leaders (level 3) - Environmental System Establishment
    endalk_id = emp("Ato Endalkachew Shiferaw", "endalkachew.shiferaw@epa.gov.et", "Team Leader - MRV & Reporting", "G8",
                    mrv_id, hirut_id, position_id=pos_mrv_lead, joined=720)
    tsion_id = emp("W/ro Tsion Fikre", "tsion.fikre@epa.gov.et", "Team Leader - Adaptation", "G8",
                   adaptation_id, hirut_id, position_id=pos_adaptation_lead, joined=680)
    yared_id = emp("Ato Yared Teshome", "yared.teshome@epa.gov.et", "Team Leader - Monitoring", "G8",
                   monitoring_id, hirut_id, position_id=pos_monitoring_lead, joined=650)

    # Staff - Environmental Regulatory Sector
    # ESIA Review Team (reporting to Team Leader Solomon)
    dawit_id = emp("Ato Dawit Mekonnen", "dawit.mekonnen@epa.gov.et", "Senior ESIA Expert", "G7",
                   esia_review_id, solomon_id, position_id=pos_senior_esia, joined=800)
    yonas_id = emp("Ato Yonas Desta", "yonas.desta@epa.gov.et", "ESIA Expert", "G6",
                   esia_review_id, solomon_id, position_id=pos_esia_expert, joined=400)
    # Inspection Team (reporting to Team Leader Leul)
    fatuma_id = emp("W/ro Fatuma Ahmed", "fatuma.ahmed@epa.gov.et", "Environmental Inspector", "G7",
                    inspection_id, leul_id, position_id=pos_inspector, joined=600)
    habtamu_id = emp("Ato Habtamu Lemma", "habtamu.lemma@epa.gov.et", "Senior Environmental Inspector", "G8",
                     inspection_id, leul_id, position_id=pos_senior_inspector, joined=700)
    # Enforcement Team (reporting to Team Leader Meseret)
    selam_id = emp("W/ro Selam Assefa", "selam.assefa@epa.gov.et", "Enforcement Officer", "G6",
                   enforcement_id, meseret_id, position_id=pos_enforcement_officer, joined=300)
    # Team leaders for teams that hold staff but previously had no lead
    eia_licensing_lead_id = emp("Ato Bekele Shiferaw", "bekele.shiferaw@epa.gov.et", "Team Leader - EIA Licensing", "G8",
                                eia_licensing_id, tesfaye_id, position_id=pos_eia_licensing_lead, joined=500)
    biosafety_lead_id = emp("W/ro Tirunesh Mengistu", "tirunesh.mengistu@epa.gov.et", "Team Leader - Biosafety", "G8",
                            biosafety_team_id, tesfaye_id, position_id=pos_biosafety_lead, joined=450)
    data_mgmt_lead_id = emp("Ato Israel Solomon", "israel.solomon@epa.gov.et", "Team Leader - Data Management", "G8",
                            data_mgmt_id, hirut_id, position_id=pos_data_mgmt_lead, joined=420)
    pollution_mon_lead_id = emp("W/ro Mahlet Girma", "mahlet.girma@epa.gov.et", "Team Leader - Pollution Monitoring", "G8",
                                pollution_mon_id, hirut_id, position_id=pos_pollution_mon_lead, joined=380)
    ict_lead_id = emp("Ato Fischa Tadesse", "fischa.tadesse@epa.gov.et", "Team Leader - ICT Support", "G8",
                      ict_support_id, getachew_id, position_id=pos_ict_lead, joined=360)
    hr_lead_id = emp("W/ro Etsegenet Alemu", "etsegenet.alemu@epa.gov.et", "Team Leader - HR Operations", "G8",
                     hr_ops_id, rediat_id, position_id=pos_hr_lead, joined=340)
    proc_lead_id = emp("Ato Tekle Berhanu", "tekle.berhanu@epa.gov.et", "Team Leader - Procurement", "G8",
                       proc_team_id, getachew_id, position_id=pos_proc_lead, joined=330)
    fin_lead_id = emp("W/ro Azeb Mesfin", "azeb.mesfin@epa.gov.et", "Team Leader - Finance Operations", "G8",
                      fin_ops_id, getachew_id, position_id=pos_fin_lead, joined=320)
    policy_lead_id = emp("Ato Mulugeta Bekele", "mulugeta.bekele@epa.gov.et", "Team Leader - Policy Analysis", "G8",
                         policy_team_id, lelise_id, position_id=pos_policy_lead, joined=310)
    dg_sec_lead_id = emp("Ato Samuel Demissie", "samuel.demissie@epa.gov.et", "Team Leader - DG Secretariat", "G8",
                         dg_sec_id, lelise_id, position_id=pos_dg_sec_lead, joined=280)

    # Remaining Regulatory staff (reporting to their team leaders)
    mulu_id = emp("W/ro Mulu Getahun", "mulu.getahun@epa.gov.et", "EIA Licensing Officer", "G6",
                  eia_licensing_id, eia_licensing_lead_id, position_id=pos_eia_licensing, joined=350)
    abebe_id = emp("Ato Abebe Chekol", "abebe.chekol@epa.gov.et", "Biosafety Officer", "G7",
                   biosafety_team_id, biosafety_lead_id, position_id=pos_biosafety_officer, joined=500)

    # Staff - Environmental System Establishment
    # MRV & Reporting Team (reporting to Team Leader Endalkachev)
    bereket_id = emp("Ato Bereket Tesfa", "bereket.tesfa@epa.gov.et", "Climate Change Specialist", "G7",
                     mrv_id, endalk_id, position_id=pos_climate_spec, joined=650)
    # Adaptation Team (reporting to Team Leader Tsion)
    hanan_id = emp("W/ro Hanan Yusuf", "hanan.yusuf@epa.gov.et", "Adaptation Planning Specialist", "G6",
                   adaptation_id, tsion_id, position_id=pos_adaptation_spec, joined=450)
    # Monitoring Team (reporting to Team Leader Yared)
    tadesse_id = emp("Ato Tadesse Belay", "tadesse.belay@epa.gov.et", "Environmental Monitoring Engineer", "G7",
                     monitoring_id, yared_id, position_id=pos_monitoring_eng, joined=550)
    aisha_id = emp("W/ro Aisha Mohammed", "aisha.mohammed@epa.gov.et", "Air Quality Specialist", "G6",
                   monitoring_id, yared_id, position_id=pos_air_quality_spec, joined=250)
    # Remaining Env Systems staff (director-level reporting)
    girum_id = emp("Ato Girum Ayalew", "girum.ayalew@epa.gov.et", "Environmental Data Analyst", "G6",
                   data_mgmt_id, data_mgmt_lead_id, position_id=pos_data_analyst, joined=350)
    nardos_id = emp("W/ro Nardos Tsegaye", "nardos.tsegaye@epa.gov.et", "E-Waste Management Specialist", "G6",
                    pollution_mon_id, pollution_mon_lead_id, position_id=pos_electronic_wr, joined=200)

    # Staff - Corporate Services
    sara_id = emp("W/ro Sara Tadesse", "sara.tadesse@epa.gov.et", "ICT Officer", "G6",
                  ict_support_id, ict_lead_id, position_id=pos_ict_officer, joined=500)
    kebede_id = emp("Ato Kebede Derese", "kebede.derese@epa.gov.et", "HRIS Specialist", "G6",
                    hr_ops_id, hr_lead_id, position_id=pos_hris_spec, joined=400)
    ashan_id = emp("W/ro Ashan Ebrahim", "ashan.ebrahim@epa.gov.et", "Procurement Officer", "G6",
                   proc_team_id, proc_lead_id, position_id=pos_procurement_officer, joined=350)
    tamrat_id = emp("Ato Tamrat Hailu", "tamrat.hailu@epa.gov.et", "Budget & Finance Officer", "G6",
                    fin_ops_id, fin_lead_id, position_id=pos_budget_officer, joined=450)

    # Staff - DG Office / Policy
    memhir_id = emp("Ato Memhirework Tilahun", "memhirework.tilahun@epa.gov.et", "DG Secretary", "G8",
                    dg_sec_id, dg_sec_lead_id, position_id=pos_dg_secretary, joined=800)
    lemnede_id = emp("W/ro Lemnedework Abebe", "lemnedeework.abebe@epa.gov.et",
                     "Director - Policy & International Affairs", "G9",
                     policy_id, lelise_id, position_id=pos_policy_dir, joined=750)
    addisu_id = emp("Ato Addisu Legesse", "addisu.legesse@epa.gov.et", "Policy Analyst", "G7",
                    policy_team_id, policy_lead_id, position_id=pos_policy_advocate, joined=400)
    kidist_id = emp("W/ro Kidist Alemayehu", "kidist.alemayehu@epa.gov.et", "MEAs Coordination Officer", "G6",
                    policy_team_id, policy_lead_id, position_id=pos_mea_coord, joined=300)

    # Fix policy team lead's manager now that the Policy director exists
    db.execute("UPDATE employees SET manager_id=? WHERE id=?", (lemnede_id, policy_lead_id))

    # ---------------- Reporting relationships ----------------
    def report(emp_id, sup_id, rtype="primary", start_days=700, end_days=None, reason=None):
        db.execute(
            "INSERT INTO reporting_relationships (employee_id, supervisor_id, relationship_type, "
            "start_date, end_date, reason, is_active) VALUES (?,?,?,?,?,?,?)",
            (emp_id, sup_id, rtype,
             (today - timedelta(days=start_days)).isoformat(),
             (today - timedelta(days=end_days)).isoformat() if end_days else None,
             reason, 1 if end_days is None else 0),
        )

    # Primary chain of command
    report(rediat_id, lelise_id, "primary", 1200)
    report(tesfaye_id, lelise_id, "primary", 1100)
    report(hirut_id, lelise_id, "primary", 1000)
    report(getachew_id, lelise_id, "primary", 900)
    report(lemnede_id, lelise_id, "primary", 750)
    report(memhir_id, lelise_id, "primary", 800)

    # Team leaders -> directors
    report(solomon_id, tesfaye_id, "primary", 750)
    report(leul_id, tesfaye_id, "primary", 720)
    report(meseret_id, tesfaye_id, "primary", 700)
    report(eia_licensing_lead_id, tesfaye_id, "primary", 500)
    report(biosafety_lead_id, tesfaye_id, "primary", 450)
    report(endalk_id, hirut_id, "primary", 720)
    report(tsion_id, hirut_id, "primary", 680)
    report(yared_id, hirut_id, "primary", 650)
    report(data_mgmt_lead_id, hirut_id, "primary", 420)
    report(pollution_mon_lead_id, hirut_id, "primary", 380)
    report(ict_lead_id, getachew_id, "primary", 360)
    report(hr_lead_id, rediat_id, "primary", 340)
    report(proc_lead_id, getachew_id, "primary", 330)
    report(fin_lead_id, getachew_id, "primary", 320)
    report(policy_lead_id, lemnede_id, "primary", 310)
    report(dg_sec_lead_id, lelise_id, "primary", 280)

    # Team members -> team leaders
    report(dawit_id, solomon_id, "primary", 800)
    report(yonas_id, solomon_id, "primary", 400)
    report(fatuma_id, leul_id, "primary", 600)
    report(habtamu_id, leul_id, "primary", 700)
    report(selam_id, meseret_id, "primary", 300)
    report(mulu_id, eia_licensing_lead_id, "primary", 350)
    report(abebe_id, biosafety_lead_id, "primary", 500)
    report(bereket_id, endalk_id, "primary", 650)
    report(hanan_id, tsion_id, "primary", 450)
    report(tadesse_id, yared_id, "primary", 550)
    report(aisha_id, yared_id, "primary", 250)
    report(girum_id, data_mgmt_lead_id, "primary", 350)
    report(nardos_id, pollution_mon_lead_id, "primary", 200)

    report(sara_id, ict_lead_id, "primary", 500)
    report(kebede_id, hr_lead_id, "primary", 400)
    report(ashan_id, proc_lead_id, "primary", 350)
    report(tamrat_id, fin_lead_id, "primary", 450)

    report(memhir_id, dg_sec_lead_id, "primary", 800)
    report(addisu_id, policy_lead_id, "primary", 400)
    report(kidist_id, policy_lead_id, "primary", 300)

    # Functional relationship: Dawit supports climate change ESIA reviews
    report(dawit_id, hirut_id, "functional", 200, reason="Cross-sectoral ESIA support for climate activities")
    # Acting relationship: Fatuma temporarily covers inspection during Habtamu's leave
    report(fatuma_id, habtamu_id, "acting", 30, end_days=5, reason="Acting Senior Inspector during leave")

    # ---------------- Org history (transfers / reorgs / promotions) ----------------
    def org_history(emp_id, unit_id, pos_id, days, reason, changed_by=None):
        db.execute(
            "INSERT INTO employee_org_history (employee_id, org_unit_id, position_id, effective_date, "
            "reason, changed_by) VALUES (?,?,?,?,?,?)",
            (emp_id, unit_id, pos_id, (today - timedelta(days=days)).isoformat(), reason, changed_by),
        )

    org_history(lelise_id, authority_id, pos_dg, 1500, "Appointed Director General of EPA", None)
    org_history(rediat_id, hr_id, pos_hr_dir, 1200, "Appointed HR Director", lelise_id)
    org_history(tesfaye_id, regulatory_id, pos_reg_dir, 1100, "Appointed Director - Environmental Regulatory Sector", lelise_id)
    org_history(hirut_id, env_sys_id, pos_sys_dir, 1000, "Appointed Director - Environmental System Establishment", lelise_id)
    org_history(getachew_id, corporate_id, pos_corp_dir, 900, "Appointed Director - Corporate Services", lelise_id)
    org_history(dawit_id, esia_review_id, pos_senior_esia, 800, "Hired as Senior ESIA Expert", tesfaye_id)
    org_history(fatuma_id, inspection_id, pos_inspector, 600, "Hired as Environmental Inspector", tesfaye_id)
    org_history(bereket_id, mrv_id, pos_climate_spec, 650, "Hired as Climate Change Specialist", hirut_id)
    org_history(tadesse_id, monitoring_id, pos_monitoring_eng, 550, "Hired as Environmental Monitoring Engineer", hirut_id)
    org_history(sara_id, ict_id, pos_ict_officer, 500, "Hired as ICT Officer", getachew_id)
    org_history(yonas_id, esia_review_id, pos_esia_expert, 400, "Transferred from EIA Licensing to ESIA Review", tesfaye_id)
    org_history(kebede_id, hr_id, pos_hris_spec, 400, "Hired as HRIS Specialist", rediat_id)
    org_history(addisu_id, policy_id, pos_policy_advocate, 400, "Hired as Policy Analyst", lemnede_id)

    # ---------------- Roles & permissions (RBAC) ----------------
    def role(name, description, system=1):
        db.execute(
            "INSERT INTO roles (name, description, system_default) VALUES (?,?,?)",
            (name, description, system),
        )
        return db.execute("SELECT id FROM roles WHERE name=?", (name,)).fetchone()["id"]

    def permission(code, name, description):
        db.execute(
            "INSERT INTO permissions (code, name, description) VALUES (?,?,?)",
            (code, name, description),
        )
        return db.execute("SELECT id FROM permissions WHERE code=?", (code,)).fetchone()["id"]

    def grant(role_id, *perm_ids):
        for pid in perm_ids:
            db.execute(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?,?)",
                (role_id, pid),
            )

    r_admin = role("admin", "Full platform administration")
    r_exec = role("executive", "Executive oversight and reporting")
    r_director = role("director", "Directorate Director: plan & oversee performance across the directorate")
    r_dept_head = role("dept_head", "Department Head: oversee teams and their plans within a department")
    r_team_leader = role("team_leader", "Team Leader: follow up on every member's tasks and activity")
    r_emp = role("employee", "Self-service: fill evaluations and acknowledge results")
    r_hr = role("hr_manager", "HR operations: org structure, positions, reporting relationships")

    p_org_view = permission("org.view", "View org structure", "Read org units, positions, and reporting relationships.")
    p_org_manage = permission("org.manage", "Manage org structure", "Create/edit org units, positions, and reporting relationships.")
    p_emp_view = permission("employee.view", "View employees", "Read employee records beyond one's own scope.")
    p_emp_manage = permission("employee.manage", "Manage employees", "Create/edit employees and assign positions.")
    p_cycle = permission("cycle.manage", "Manage cycles", "Create and configure performance cycles.")
    p_kpi = permission("kpi.manage", "Manage KPIs", "Create and update KPI targets.")
    p_goal = permission("goal.manage", "Manage goals", "Create and update goals.")
    p_comp = permission("competency.manage", "Manage competencies", "Create and update the competency framework.")
    p_eval_build = permission("evaluation.build", "Build evaluation forms", "Create and version evaluation templates.")
    p_eval_assign = permission("evaluation.assign", "Assign evaluations", "Assign evaluation perspectives to evaluators.")
    p_eval_approve = permission("evaluation.approve", "Approve evaluations", "Approve, decline, or return submitted evaluations.")
    p_eval_fill = permission("evaluation.fill", "Fill evaluations", "Submit answers for assigned evaluation perspectives.")
    p_eval_ack = permission("evaluation.acknowledge", "Acknowledge results", "Acknowledge or dispute a finalized evaluation result.")
    p_report = permission("report.view", "View reports", "Access performance and organizational reports.")
    p_report_export = permission("report.export", "Export reports", "Download reports as CSV.")
    p_audit = permission("audit.view", "View audit log", "Read the platform audit trail.")
    p_admin = permission("admin.all", "Full admin", "Unrestricted access across the platform.")

    grant(r_admin, p_admin)
    grant(r_exec, p_org_view, p_emp_view, p_report, p_report_export, p_audit,
          p_eval_build, p_eval_approve, p_goal, p_kpi)
    grant(r_director, p_org_view, p_emp_view, p_goal, p_kpi, p_comp,
          p_eval_assign, p_eval_approve, p_eval_fill, p_report)
    grant(r_dept_head, p_org_view, p_emp_view, p_goal, p_kpi,
          p_eval_assign, p_eval_approve, p_eval_fill, p_report)
    grant(r_team_leader, p_org_view, p_emp_view, p_goal,
          p_eval_assign, p_eval_fill, p_report)
    grant(r_emp, p_org_view, p_eval_fill, p_eval_ack)
    grant(r_hr, p_org_view, p_org_manage, p_emp_view, p_emp_manage, p_cycle,
          p_eval_build, p_eval_assign, p_audit, p_report, p_report_export)

    # ---------------- Users ----------------
    def add_user(username, role, employee_id):
        db.execute(
            "INSERT INTO users (username, password_hash, role, employee_id, role_id) "
            "SELECT ?,?,?,?, id FROM roles WHERE name=?",
            (username, hash_password(DEMO_PASSWORD), role, employee_id, role),
        )

    add_user("admin1", "admin", rediat_id)
    add_user("exec1", "executive", lelise_id)
    add_user("director1", "director", tesfaye_id)
    add_user("director2", "director", hirut_id)
    add_user("depthead1", "dept_head", lemnede_id)
    add_user("lead1", "team_leader", solomon_id)
    add_user("lead2", "team_leader", leul_id)
    add_user("lead3", "team_leader", endalk_id)
    add_user("employee1", "employee", dawit_id)
    add_user("employee2", "employee", fatuma_id)
    add_user("employee3", "employee", bereket_id)
    add_user("employee4", "employee", sara_id)

    # ---------------- Competency framework ----------------
    comp_defs = [
        ("Environmental Impact Assessment", "technical",
         "Ability to conduct and review environmental and social impact assessments."),
        ("Regulatory Compliance", "technical",
         "Knowledge of environmental laws, regulations, and enforcement procedures."),
        ("Climate Change Adaptation", "technical",
         "Understanding of climate risks, adaptation planning, and resilience strategies."),
        ("Environmental Monitoring", "technical",
         "Proficiency in air, water, and soil quality monitoring methodologies."),
        ("Stakeholder Engagement", "behavioral",
         "Effectively engaging communities, agencies, and international partners."),
        ("Analytical Thinking", "behavioral",
         "Breaking down complex environmental data and evaluating options rigorously."),
        ("Communication", "behavioral",
         "Clear reporting and coordination across teams and external partners."),
        ("Policy Development", "leadership",
         "Drafting, reviewing, and implementing environmental policies and standards."),
        ("People Leadership", "leadership",
         "Guiding, coaching, and developing team members."),
        ("Strategic Thinking", "leadership",
         "Aligning unit work with national environmental priorities and EPA mandate."),
    ]
    for name, cat, definition in comp_defs:
        db.execute("INSERT INTO competencies (name, category, definition) VALUES (?,?,?)", (name, cat, definition))

    comp_ids = {row["name"]: row["id"] for row in db.execute("SELECT id, name FROM competencies").fetchall()}

    def set_comp(emp_id, name, current, target):
        db.execute(
            "INSERT INTO employee_competencies (employee_id, competency_id, current_level, target_level) VALUES (?,?,?,?)",
            (emp_id, comp_ids[name], current, target),
        )

    # Dawit — Senior ESIA Expert
    set_comp(dawit_id, "Environmental Impact Assessment", 4, 5)
    set_comp(dawit_id, "Regulatory Compliance", 3, 4)
    set_comp(dawit_id, "Communication", 3, 4)
    set_comp(dawit_id, "Analytical Thinking", 4, 5)

    # Fatuma — Environmental Inspector
    set_comp(fatuma_id, "Regulatory Compliance", 4, 5)
    set_comp(fatuma_id, "Environmental Monitoring", 3, 4)
    set_comp(fatuma_id, "Stakeholder Engagement", 3, 4)
    set_comp(fatuma_id, "Communication", 3, 4)

    # Bereket — Climate Change Specialist
    set_comp(bereket_id, "Climate Change Adaptation", 4, 5)
    set_comp(bereket_id, "Environmental Monitoring", 3, 4)
    set_comp(bereket_id, "Analytical Thinking", 4, 5)
    set_comp(bereket_id, "Communication", 3, 4)

    # Sara — ICT Officer
    set_comp(sara_id, "Analytical Thinking", 3, 4)
    set_comp(sara_id, "Communication", 4, 4)
    set_comp(sara_id, "Stakeholder Engagement", 3, 4)

    # ---------------- KPIs ----------------
    def add_kpi(emp_id, cid, name, definition, unit, target, actual, weight, direction="higher_is_better"):
        db.execute(
            "INSERT INTO kpis (employee_id, cycle_id, name, definition, measurement_unit, target_value, "
            "actual_value, weight, direction) VALUES (?,?,?,?,?,?,?,?,?)",
            (emp_id, cid, name, definition, unit, target, actual, weight, direction),
        )

    add_kpi(dawit_id, cycle_id, "ESIA Report Completion Rate",
            "% of assigned ESIA reviews completed within deadline", "%", 90, 82, 0.5)
    add_kpi(dawit_id, cycle_id, "Stakeholder Consultation Coverage",
            "% of required stakeholder consultations conducted", "%", 95, 88, 0.3)
    add_kpi(dawit_id, cycle_id, "Quality Assurance Score",
            "Average QA review score on submitted ESIA reports", "/100", 85, 79, 0.2)

    add_kpi(fatuma_id, cycle_id, "Compliance Inspection Rate",
            "% of scheduled inspections completed on time", "%", 90, 76, 0.4)
    add_kpi(fatuma_id, cycle_id, "Violation Citation Accuracy",
            "% of citations upheld upon review", "%", 95, 91, 0.3)
    add_kpi(fatuma_id, cycle_id, "Inspection Report Turnaround",
            "Average days to submit inspection report", "days", 7, 9, 0.3, "lower_is_better")

    add_kpi(bereket_id, cycle_id, "GHG Inventory Submission",
            "Timely submission of national GHG inventory report", "%", 100, 100, 0.4)
    add_kpi(bereket_id, cycle_id, "MRV Data Accuracy",
            "Accuracy rate of monitoring, reporting, and verification data", "%", 98, 95, 0.3)
    add_kpi(bereket_id, cycle_id, "Adaptation Plan Coverage",
            "% of priority sectors with completed adaptation plans", "%", 80, 65, 0.3)

    add_kpi(sara_id, cycle_id, "System Uptime",
            "% uptime for EPA core IT systems", "%", 99.5, 99.2, 0.4)
    add_kpi(sara_id, cycle_id, "Help Desk Resolution Time",
            "Average hours to resolve IT support tickets", "hours", 24, 18, 0.3, "lower_is_better")
    add_kpi(sara_id, cycle_id, "Cybersecurity Incident Rate",
            "Number of security incidents per quarter", "count", 0, 1, 0.3, "lower_is_better")

    # ---------------- Goals ----------------
    def add_goal(emp_id, cid, title, description, baseline, target, actual, weight, status, days_left=30):
        db.execute(
            "INSERT INTO goals (employee_id, cycle_id, title, description, baseline, target_value, actual_value, "
            "weight, priority, start_date, end_date, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                emp_id, cid, title, description, baseline, target, actual, weight, "high",
                (today - timedelta(days=45)).isoformat(), (today + timedelta(days=days_left)).isoformat(), status,
            ),
        )

    add_goal(dawit_id, cycle_id, "Clear national ESIA backlog",
             "Complete review of 50 pending ESIA reports from Q1.",
             0, 50, 35, 0.6, "in_progress", 20)
    add_goal(dawit_id, cycle_id, "Streamline ESIA review process",
             "Reduce average review cycle from 45 to 30 days.",
             45, 30, 38, 0.4, "at_risk", 15)

    add_goal(fatuma_id, cycle_id, "Conduct industrial compliance audits",
             "Complete compliance audits for 30 industrial facilities.",
             0, 30, 22, 0.5, "in_progress", 25)
    add_goal(fatuma_id, cycle_id, "Update inspection checklists",
             "Revise checklists to align with Regulation 545/2024.",
             0, 100, 60, 0.5, "in_progress", 40)

    add_goal(bereket_id, cycle_id, "Submit national GHG inventory to UNFCCC",
             "Complete and submit Ethiopia's 2025 greenhouse gas inventory.",
             0, 100, 100, 0.5, "completed", 5)
    add_goal(bereket_id, cycle_id, "Develop climate vulnerability assessment",
             "Complete vulnerability assessment for 5 priority sectors.",
             0, 5, 2, 0.5, "in_progress", 35)

    add_goal(sara_id, cycle_id, "Deploy EPA e-service portal",
             "Launch online ESIA application and tracking portal.",
             0, 100, 70, 0.6, "in_progress", 30)
    add_goal(sara_id, cycle_id, "Migrate to cloud infrastructure",
             "Migrate core systems from on-premise to cloud.",
             0, 100, 40, 0.4, "in_progress", 45)

    # ---------------- Historical scores for the past cycle (feeds trend charts) ----------------
    def past_score(emp_id, overall):
        db.execute(
            "INSERT INTO performance_scores (employee_id, cycle_id, kpi_score, goal_score, competency_score, "
            "behavior_score, program_score, overall_score, rating_label, calculated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,datetime('now','-90 days'))",
            (emp_id, past_cycle_id, overall - 6, overall - 3, overall - 4, overall - 2, overall - 5,
             overall, "Meets Expectations"),
        )

    past_score(dawit_id, 72)
    past_score(fatuma_id, 78)
    past_score(bereket_id, 81)
    past_score(sara_id, 74)

    # ---------------- Evaluations ----------------
    def add_eval(emp_id, cid, evaluator_id, etype, behavior, program_score, comments):
        db.execute(
            "INSERT INTO evaluations (employee_id, cycle_id, evaluator_id, evaluator_type, behavior_score, "
            "program_score, comments, status, submitted_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
            (emp_id, cid, evaluator_id, etype, behavior, program_score, comments, "submitted"),
        )

    add_eval(dawit_id, cycle_id, tesfaye_id, "manager", 78, 75,
             "Strong ESIA technical skills; stakeholder engagement improving.")
    add_eval(dawit_id, cycle_id, dawit_id, "self", 74, 70,
             "Met most review targets; backlog reduction needs more focus.")
    add_eval(fatuma_id, cycle_id, tesfaye_id, "manager", 82, 80,
             "Thorough inspections; citation accuracy is excellent.")
    add_eval(fatuma_id, cycle_id, fatuma_id, "self", 76, 74,
             "Good field work; report turnaround needs improvement.")
    add_eval(bereket_id, cycle_id, hirut_id, "manager", 88, 90,
             "Outstanding GHG inventory work; adaptation planning on track.")
    add_eval(bereket_id, cycle_id, bereket_id, "self", 82, 85,
             "Proud of the UNFCCC submission; want to push adaptation faster.")
    add_eval(sara_id, cycle_id, getachew_id, "manager", 80, 76,
             "Reliable IT operations; e-service portal delivery tracking well.")
    add_eval(sara_id, cycle_id, sara_id, "self", 78, 72,
             "Good progress on systems; cloud migration needs more attention.")

    # ---------------- Leaders are evaluated too ----------------
    # Directors and the DG carry their own KPIs, goals, competencies,
    # self-assessments, and manager evaluations.

    # Rediat Amare — HR Director
    set_comp(rediat_id, "People Leadership", 4, 5)
    set_comp(rediat_id, "Strategic Thinking", 4, 5)
    set_comp(rediat_id, "Communication", 4, 5)
    set_comp(rediat_id, "Analytical Thinking", 3, 4)
    add_kpi(rediat_id, cycle_id, "Staff Recruitment Fill Rate",
            "% of authorized positions filled within the cycle", "%", 95, 88, 0.4)
    add_kpi(rediat_id, cycle_id, "Employee Satisfaction Score",
            "Org-wide staff satisfaction survey result", "%", 80, 72, 0.3)
    add_kpi(rediat_id, cycle_id, "Training Completion Rate",
            "% of planned capacity-building activities completed", "%", 90, 82, 0.3)
    add_goal(rediat_id, cycle_id, "Implement EPA performance management system",
             "Roll out the new PMS across all directorates.",
             0, 100, 85, 0.6, "in_progress", 40)
    add_goal(rediat_id, cycle_id, "Reduce staff vacancy rate",
             "Bring vacancy rate below 10% across all units.",
             18, 10, 12, 0.4, "in_progress", 60)
    add_eval(rediat_id, cycle_id, lelise_id, "manager", 84, 80,
             "Strong HR leadership; PMS rollout is a key achievement.")
    add_eval(rediat_id, cycle_id, rediat_id, "self", 80, 76,
             "Pleased with recruitment progress; need to focus on retention.")

    # Dr. Lelise Neme — Director General (evaluated by the org head / admin)
    set_comp(lelise_id, "Strategic Thinking", 5, 5)
    set_comp(lelise_id, "People Leadership", 4, 5)
    set_comp(lelise_id, "Policy Development", 5, 5)
    set_comp(lelise_id, "Communication", 4, 5)
    add_kpi(lelise_id, cycle_id, "National Environmental Policy Compliance",
            "% of national environmental targets met per proclamations", "%", 90, 82, 0.4)
    add_kpi(lelise_id, cycle_id, "International Engagement",
            "Number of MEA negotiation rounds participated in", "count", 6, 5, 0.3)
    add_kpi(lelise_id, cycle_id, "Stakeholder Satisfaction",
            "Satisfaction score from regional environmental bureaus", "/100", 85, 78, 0.3)
    add_goal(lelise_id, cycle_id, "Strengthen EPA institutional capacity",
             "Complete organizational restructuring and capacity building plan.",
             0, 100, 70, 0.5, "in_progress", 50)
    add_goal(lelise_id, cycle_id, "Advance Ethiopia's climate commitments",
             "Submit updated NDC and secure climate finance commitments.",
             0, 100, 60, 0.5, "in_progress", 60)
    add_eval(lelise_id, cycle_id, rediat_id, "manager", 86, 84,
             "Visionary leadership; strong on international engagements and policy direction.")
    add_eval(lelise_id, cycle_id, lelise_id, "self", 80, 82,
             "Good institutional progress; want to accelerate climate finance mobilization.")

    # Tesfaye Girma — Director, Environmental Regulatory (evaluated by DG)
    set_comp(tesfaye_id, "People Leadership", 3, 4)
    set_comp(tesfaye_id, "Regulatory Compliance", 5, 5)
    set_comp(tesfaye_id, "Strategic Thinking", 4, 5)
    set_comp(tesfaye_id, "Stakeholder Engagement", 3, 4)
    add_kpi(tesfaye_id, cycle_id, "Regulatory Enforcement Rate",
            "% of detected violations acted upon within 30 days", "%", 95, 88, 0.4)
    add_kpi(tesfaye_id, cycle_id, "ESIA Backlog Reduction",
            "% reduction in pending ESIA reviews vs. start of cycle", "%", 50, 35, 0.3)
    add_kpi(tesfaye_id, cycle_id, "Team Capacity Utilization",
            "% of regulatory staff actively assigned to cases", "%", 90, 82, 0.3)
    add_goal(tesfaye_id, cycle_id, "Establish environmental compliance database",
             "Deploy digital system for tracking facility compliance status.",
             0, 100, 45, 0.5, "in_progress", 40)
    add_goal(tesfaye_id, cycle_id, "Conduct 100 industrial inspections",
             "Complete compliance inspections for 100 industrial facilities.",
             0, 100, 68, 0.5, "in_progress", 30)
    add_eval(tesfaye_id, cycle_id, lelise_id, "manager", 82, 78,
             "Strong regulatory knowledge; team delivery is solid.")
    add_eval(tesfaye_id, cycle_id, tesfaye_id, "self", 76, 74,
             "Good inspection coverage; ESIA backlog needs faster reduction.")

    # Hirut Bekele — Director, Environmental System Establishment (evaluated by DG)
    set_comp(hirut_id, "People Leadership", 3, 4)
    set_comp(hirut_id, "Climate Change Adaptation", 4, 5)
    set_comp(hirut_id, "Strategic Thinking", 4, 5)
    set_comp(hirut_id, "Analytical Thinking", 4, 5)
    add_kpi(hirut_id, cycle_id, "Climate Reporting Timeliness",
            "% of national climate reports submitted on schedule", "%", 100, 92, 0.4)
    add_kpi(hirut_id, cycle_id, "Pollution Monitoring Coverage",
            "% of monitoring stations with continuous data", "%", 85, 70, 0.3)
    add_kpi(hirut_id, cycle_id, "Adaptation Plan Adoption",
            "% of regional bureaus adopting national adaptation plans", "%", 80, 55, 0.3)
    add_goal(hirut_id, cycle_id, "Complete national MRV system upgrade",
             "Deploy upgraded monitoring, reporting, and verification platform.",
             0, 100, 75, 0.5, "in_progress", 25)
    add_goal(hirut_id, cycle_id, "Expand pollution monitoring network",
             "Install 20 new air/water quality monitoring stations.",
             0, 20, 8, 0.5, "in_progress", 50)
    add_eval(hirut_id, cycle_id, lelise_id, "manager", 80, 76,
             "Strong technical leadership; climate reporting is on track.")
    add_eval(hirut_id, cycle_id, hirut_id, "self", 74, 70,
             "Good MRV progress; pollution monitoring network expansion needs acceleration.")

    # Historical scores for leaders so their trend charts have a prior point.
    past_score(rediat_id, 78)
    past_score(lelise_id, 82)
    past_score(tesfaye_id, 76)
    past_score(hirut_id, 74)

    # ---------------- Evaluation form workflow ----------------
    def form(name, description, approval_levels, weights=None):
        w = weights or {}
        db.execute(
            "INSERT INTO evaluation_forms (name, description, approval_levels, active, "
            "weight_self, weight_manager, weight_peer) VALUES (?,?,?,1,?,?,?)",
            (name, description, approval_levels, w.get("self", 1), w.get("manager", 1), w.get("peer", 1)),
        )
        return db.execute("SELECT id FROM evaluation_forms WHERE name=?", (name,)).fetchone()["id"]

    def section(fid, title, description, weight, perspective="self"):
        order = db.execute(
            "SELECT COALESCE(MAX(order_index), -1) + 1 o FROM evaluation_form_sections WHERE form_id=?",
            (fid,)).fetchone()["o"]
        db.execute(
            "INSERT INTO evaluation_form_sections (form_id, title, description, weight, perspective, order_index) "
            "VALUES (?,?,?,?,?,?)",
            (fid, title, description, weight, perspective, order),
        )
        return db.execute(
            "SELECT id FROM evaluation_form_sections WHERE form_id=? AND title=? AND perspective=?",
            (fid, title, perspective)).fetchone()["id"]

    def question(sid, text, kind, max_score=None, description=None, options=None, required=0):
        order = db.execute(
            "SELECT COALESCE(MAX(order_index), -1) + 1 o FROM evaluation_form_questions WHERE section_id=?",
            (sid,)).fetchone()["o"]
        db.execute(
            "INSERT INTO evaluation_form_questions (section_id, text, description, kind, max_score, options, "
            "required, order_index) VALUES (?,?,?,?,?,?,?,?)",
            (sid, text, description, kind, max_score,
             json.dumps(options) if options else None, required, order),
        )
        return db.execute(
            "SELECT id FROM evaluation_form_questions WHERE section_id=? AND text=?",
            (sid, text)).fetchone()["id"]

    def assign(fid, emp_id, cid, status="draft", level=0, submitted=False, score=None,
               evaluator_type="self", evaluator_id=None, due_days=14, overall=None):
        eid = evaluator_id if evaluator_id is not None else emp_id
        db.execute(
            "INSERT INTO evaluation_assignments (form_id, employee_id, cycle_id, evaluator_type, evaluator_id, "
            "due_date, status, current_level, score, max_score, overall_score, submitted_at, finalized_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (fid, emp_id, cid, evaluator_type, eid,
             (today + timedelta(days=due_days)).isoformat(),
             status, level, score, 100 if score is not None else None, overall,
             (datetime.isoformat(datetime.combine(today - timedelta(days=2), datetime.min.time())) if submitted else None),
             (datetime.isoformat(datetime.combine(today - timedelta(days=1), datetime.min.time())) if score is not None else None)),
        )
        return db.execute(
            "SELECT id FROM evaluation_assignments WHERE form_id=? AND employee_id=? AND cycle_id=? "
            "AND evaluator_type=?",
            (fid, emp_id, cid, evaluator_type)).fetchone()["id"]

    def answer(aid, qid, rating=None, text=None, note=None):
        db.execute(
            "INSERT INTO evaluation_answers (assignment_id, question_id, rating_value, text_value, note) "
            "VALUES (?,?,?,?,?)",
            (aid, qid, rating, text, note),
        )

    def approve(aid, approver_id, level, decision="approved", comments=""):
        db.execute(
            "INSERT INTO evaluation_approvals (assignment_id, level, approver_id, decision, comments, decided_at) "
            "VALUES (?,?,?,?,?,datetime('now'))",
            (aid, level, approver_id, decision, comments),
        )

    review_id = form(
        "H2 2026 Performance Review",
        "360-style review across five evaluation perspectives. Approved by the manager chain, then scored.",
        2,
    )
    self_s = section(review_id, "Self Assessment", "The employee's honest view of the cycle.", 0.15)
    kpi_s = section(review_id, "KPI Results", "Delivered results against committed targets.", 0.25)
    comp_s = section(review_id, "Competency Growth", "Technical and behavioral capability.", 0.25)
    beh_s = section(review_id, "Behavior & Values", "How work was done, not just what.", 0.20)
    dev_s = section(review_id, "Future & Development", "Where the employee is heading.", 0.15)

    q_self_contrib = question(self_s, "Overall contribution to the team this cycle", "rating", 5)
    q_self_delivery = question(self_s, "Quality of your deliverables", "rating", 5)
    q_kpi = question(kpi_s, "KPI achievement across the cycle", "scale", 100)
    q_tech = question(comp_s, "Technical expertise", "rating", 5)
    q_collab = question(comp_s, "Collaboration and communication", "rating", 5)
    q_owner = question(beh_s, "Ownership and accountability", "rating", 5)
    q_adapt = question(beh_s, "Adaptability under change", "rating", 5)
    q_development = question(dev_s, "Development goals for next cycle", "text")

    probation_id = form(
        "Probation Check-in",
        "Short check-in at the end of the probation period. One manager approval.",
        1,
    )
    p_self = section(probation_id, "Probation Review", "Quick snapshot for new joiners.", 1)
    q_progress = question(p_self, "Rate progress against the orientation plan", "rating", 5)
    q_comments = question(p_self, "Any blockers or concerns?", "text")

    # Dawit — draft, not yet started
    assign(review_id, dawit_id, cycle_id, "draft")

    # Fatuma — submitted, answers filled, awaiting Tesfaye (level 1)
    fatuma_aid = assign(review_id, fatuma_id, cycle_id, "submitted", 0, submitted=True)
    answer(fatuma_aid, q_self_contrib, 4, note="Solid field inspection work this cycle.")
    answer(fatuma_aid, q_self_delivery, 4)
    answer(fatuma_aid, q_kpi, 82)
    answer(fatuma_aid, q_tech, 4)
    answer(fatuma_aid, q_collab, 4)
    answer(fatuma_aid, q_owner, 4)
    answer(fatuma_aid, q_adapt, 4)
    answer(fatuma_aid, q_development, text="Improve inspection report turnaround time and mentoring junior inspectors.")

    # Lelise — scored on submission. As a root employee (DG, no manager above)
    # she has no approval chain: 0 approval levels, auto-scored.
    lelise_aid = assign(review_id, lelise_id, cycle_id, "scored", 0, submitted=True, score=93)
    answer(lelise_aid, q_self_contrib, 5)
    answer(lelise_aid, q_self_delivery, 5)
    answer(lelise_aid, q_kpi, 95)
    answer(lelise_aid, q_tech, 5)
    answer(lelise_aid, q_collab, 5)
    answer(lelise_aid, q_owner, 5)
    answer(lelise_aid, q_adapt, 4)
    answer(lelise_aid, q_development, text="Strengthen institutional capacity and international engagement.")

    # Tesfaye — submitted. His only manager is the DG, so his single
    # approval level is the apex committee (DG + HR Director must co-approve).
    tesfaye_aid = assign(review_id, tesfaye_id, cycle_id, "submitted", 0, submitted=True)
    answer(tesfaye_aid, q_self_contrib, 4)
    answer(tesfaye_aid, q_self_delivery, 4)
    answer(tesfaye_aid, q_kpi, 88)
    answer(tesfaye_aid, q_tech, 4)
    answer(tesfaye_aid, q_collab, 4)
    answer(tesfaye_aid, q_owner, 4)
    answer(tesfaye_aid, q_adapt, 3)
    answer(tesfaye_aid, q_development, text="Build stronger cross-directorate coordination for regulatory enforcement.")

    # Sara — scored (probation check-in, single approval by Getachew)
    sara_aid = assign(probation_id, sara_id, cycle_id, "scored", 1, submitted=True, score=84)
    answer(sara_aid, q_progress, 4)
    answer(sara_aid, q_comments, text="Onboarding went well; would like more exposure to environmental data systems.")
    approve(sara_aid, getachew_id, 1, "approved", "Solid progress through the orientation plan.")

    # ---------------- 360 feedback form (self + manager + peer) ----------------
    feedback_id = form(
        "360 Feedback",
        "Multi-perspective feedback: the employee, their manager, and selected peers each rate "
        "the same dimensions with their own weights.",
        2,
        weights={"self": 0.3, "manager": 0.4, "peer": 0.3},
    )
    fb_self = section(feedback_id, "Self Assessment", "Your own view of the cycle.", 0.4, "self")
    fb_manager = section(feedback_id, "Manager Review", "The manager's assessment.", 0.4, "manager")
    fb_peer = section(feedback_id, "Peer Feedback", "How colleagues experience working together.", 0.2, "peer")

    q_fb_quality = question(fb_self, "Quality of deliverables", "rating", 5, required=1)
    q_fb_owner = question(fb_self, "Ownership and reliability", "rating", 5, required=1)
    q_fb_growth = question(fb_self, "Highlight one growth area for the next cycle", "text", required=1)
    q_fb_m_quality = question(fb_manager, "Quality of deliverables", "rating", 5, required=1)
    q_fb_m_owner = question(fb_manager, "Ownership and reliability", "rating", 5, required=1)
    q_fb_m_growth = question(fb_manager, "Development priorities", "select",
                             options=["Promote soon", "Stretch role", "Stay on track"], required=1)
    q_fb_p_collab = question(fb_peer, "Collaboration and communication", "rating", 5, required=1)
    q_fb_p_reliable = question(fb_peer, "Reliability as a teammate", "rating", 5, required=1)
    q_fb_p_comments = question(fb_peer, "What did this person do well?", "multi",
                               options=["Clear communication", "Reliable delivery", "Technical guidance", "Supporting others"])

    # Dawit's 360: self (draft), manager (Tesfaye), peer (Fatuma) — all due in 10 days.
    dawit_self_aid = assign(feedback_id, dawit_id, cycle_id, "draft", evaluator_type="self", due_days=10)
    dawit_mgr_aid = assign(feedback_id, dawit_id, cycle_id, "draft", evaluator_type="manager",
                           evaluator_id=tesfaye_id, due_days=10)
    dawit_peer_aid = assign(feedback_id, dawit_id, cycle_id, "draft", evaluator_type="peer",
                            evaluator_id=fatuma_id, due_days=10)

    # Bereket's 360: all three perspectives completed and approved. Bereket's chain
    # is two levels deep: level 1 by Hirut, level 2 the apex committee where
    # both top leaders (Lelise and Rediat) must co-approve.
    bereket_self_aid = assign(feedback_id, bereket_id, cycle_id, "scored", 1, submitted=True, score=78,
                              evaluator_type="self", due_days=-5)
    answer(bereket_self_aid, q_fb_quality, 4, note="Good GHG inventory work given the tight deadline.")
    answer(bereket_self_aid, q_fb_owner, 3)
    answer(bereket_self_aid, q_fb_growth, text="Deeper engagement with regional environmental bureaus.")
    approve(bereket_self_aid, hirut_id, 1, "approved", "Self review looks fair.")
    approve(bereket_self_aid, lelise_id, 2, "approved", "Top-level sign-off (Director General).")
    approve(bereket_self_aid, rediat_id, 2, "approved", "Top-level sign-off (HR Director).")

    bereket_mgr_aid = assign(feedback_id, bereket_id, cycle_id, "scored", 1, submitted=True, score=82,
                             evaluator_type="manager", evaluator_id=hirut_id, due_days=-5)
    answer(bereket_mgr_aid, q_fb_m_quality, 4)
    answer(bereket_mgr_aid, q_fb_m_owner, 4)
    answer(bereket_mgr_aid, q_fb_m_growth, text="Stay on track")
    approve(bereket_mgr_aid, hirut_id, 1, "approved", "Manager review approved.")
    approve(bereket_mgr_aid, lelise_id, 2, "approved", "Top-level sign-off (Director General).")
    approve(bereket_mgr_aid, rediat_id, 2, "approved", "Top-level sign-off (HR Director).")

    bereket_peer_aid = assign(feedback_id, bereket_id, cycle_id, "scored", 1, submitted=True, score=88,
                              evaluator_type="peer", evaluator_id=dawit_id, due_days=-5)
    answer(bereket_peer_aid, q_fb_p_collab, 5)
    answer(bereket_peer_aid, q_fb_p_reliable, 4)
    answer(bereket_peer_aid, q_fb_p_comments, text='["Reliable delivery", "Supporting others"]')
    approve(bereket_peer_aid, hirut_id, 1, "approved", "Peer feedback captured.")
    approve(bereket_peer_aid, lelise_id, 2, "approved", "Top-level sign-off (Director General).")
    approve(bereket_peer_aid, rediat_id, 2, "approved", "Top-level sign-off (HR Director).")

    bereket_overall = round(0.3 * 78 + 0.4 * 82 + 0.3 * 88, 2)
    db.execute("UPDATE evaluation_assignments SET overall_score=? WHERE form_id=? AND employee_id=? AND cycle_id=?",
               (bereket_overall, feedback_id, bereket_id, cycle_id))

    # ---------------- Approval workflow definitions ----------------
    def workflow(name, entity_type, description):
        db.execute(
            "INSERT INTO workflow_definitions (name, entity_type, description) VALUES (?,?,?)",
            (name, entity_type, description),
        )
        return db.execute("SELECT id FROM workflow_definitions WHERE name=?", (name,)).fetchone()["id"]

    def workflow_step(wf_id, order, mode, approver_type, approver_value=None, sla_hours=None,
                      condition=None, escalation_step_id=None):
        db.execute(
            "INSERT INTO workflow_steps (workflow_id, step_order, mode, approver_type, approver_value, "
            "sla_hours, condition, escalation_step_id) VALUES (?,?,?,?,?,?,?,?)",
            (wf_id, order, mode, approver_type, approver_value, sla_hours, condition, escalation_step_id),
        )

    eval_wf = workflow(
        "Evaluation approval",
        "evaluation",
        "Sequential chain-of-command approval for submitted evaluations.",
    )
    eval_s1 = workflow_step(eval_wf, 1, "sequential", "chain_level", "1", sla_hours=48)
    workflow_step(eval_wf, 2, "sequential", "chain_level", "2", sla_hours=72)

    goal_wf = workflow(
        "Goal sign-off",
        "goal",
        "Manager approves goals; high-priority goals also require executive sign-off.",
    )
    workflow_step(goal_wf, 1, "sequential", "chain_level", "1", sla_hours=24)
    workflow_step(
        goal_wf, 2, "sequential", "role", "executive", sla_hours=48,
        condition=json.dumps({"field": "priority", "op": "eq", "value": "high"}),
    )

    # ---------------- Notifications ----------------
    def notify(username, ntype, title, body, entity_type=None, entity_id=None):
        uid = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()["id"]
        db.execute(
            "INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id) "
            "VALUES (?,?,?,?,?,?)",
            (uid, ntype, title, body, entity_type, entity_id),
        )

    notify("director2", "evaluation_pending",
           "Bereket Tesfa's 360 review needs approval",
           "The combined 360 feedback for Bereket Tesfa is awaiting your approval.",
           "evaluation", None)
    notify("employee1", "evaluation_due",
           "360 feedback due in 10 days",
           "Your self-assessment for the 360 Feedback form is due soon.",
           "evaluation", None)
    notify("exec1", "report_ready",
           "Executive summary available",
           "A new executive performance summary has been generated.",
           "report", None)

    # ---------------- Reference data (served to the frontend) ----------------
    def setting(key, value, description=None):
        db.execute(
            "INSERT INTO settings (key, value, description) VALUES (?,?,?)",
            (key, value, description))

    setting("performance.high_threshold", "80", "Overall score at/above this is a high performer")
    setting("performance.at_risk_threshold", "60", "Overall score below this flags an at-risk employee")
    setting("ai.kpi_risk_pct", "70", "KPI achievement below this percent is flagged as at risk")
    setting("ai.anomaly_swing_points", "25", "Cycle-over-cycle score swing at/above this is an anomaly signal")

    def rel_type(code, label, order):
        db.execute(
            "INSERT INTO relationship_types (code, label, sort_order) VALUES (?,?,?)",
            (code, label, order))

    rel_type("primary", "Primary", 1)
    rel_type("secondary", "Secondary", 2)
    rel_type("functional", "Functional", 3)
    rel_type("administrative", "Administrative", 4)
    rel_type("acting", "Acting", 5)
    rel_type("temporary", "Temporary", 6)

    def comp_cat(code, label, order):
        db.execute(
            "INSERT INTO competency_categories (code, label, sort_order) VALUES (?,?,?)",
            (code, label, order))

    comp_cat("technical", "Technical", 1)
    comp_cat("behavioral", "Behavioral", 2)
    comp_cat("leadership", "Leadership", 3)

    def demo_acct(username, role, note, order):
        db.execute(
            "INSERT INTO demo_accounts (username, password, role, note, sort_order) "
            "VALUES (?,?,?,?,?)",
            # The reference endpoint intentionally omits this field. Keep no
            # usable credential copy in the database; authentication uses the
            # hashed value in users.password_hash.
            (username, "", role, note, order))

    demo_acct("admin1", "HR Admin", "Full admin access", 1)
    demo_acct("exec1", "Director General", "Executive oversight", 2)
    demo_acct("director1", "Sector Director", "Directorate Director - Regulatory", 3)
    demo_acct("director2", "Sector Director", "Directorate Director - Env Systems", 4)
    demo_acct("depthead1", "Dept Head", "Policy & International Affairs", 5)
    demo_acct("lead1", "Team Leader", "ESIA Review Team", 6)
    demo_acct("lead2", "Team Leader", "Inspection Team", 7)
    demo_acct("employee1", "Senior Expert", "ESIA review specialist", 8)
    demo_acct("employee4", "ICT Officer", "IT systems support", 9)

    def nav_item(role, item_key, label, icon, order):
        db.execute(
            "INSERT INTO navigation_items (role, item_key, label, icon, sort_order) "
            "VALUES (?,?,?,?,?)",
            (role, item_key, label, icon, order))

    nav_item("admin", "executive", "Executive Overview", "dashboard", 1)
    nav_item("admin", "employees", "Employees", "users", 2)
    nav_item("admin", "organization", "Organization Setup", "org", 3)
    nav_item("admin", "programs", "Programs", "briefcase", 4)
    nav_item("admin", "forms", "Evaluation Forms", "edit", 5)
    nav_item("admin", "approvals", "Approvals", "shield", 6)
    nav_item("admin", "evaluations", "My Evaluations", "clipboard", 7)
    nav_item("admin", "anomalies", "AI Anomalies", "spark", 8)
    nav_item("admin", "audit", "Audit Log", "clock", 9)
    nav_item("admin", "myself", "My Performance", "target", 10)

    nav_item("executive", "executive", "Executive Overview", "dashboard", 1)
    nav_item("executive", "strategic_goals", "Strategic Goals", "target", 2)
    nav_item("executive", "employees", "Browse Employees", "users", 3)
    nav_item("executive", "programs", "Programs", "briefcase", 4)
    nav_item("executive", "approvals", "Approvals", "shield", 5)
    nav_item("executive", "evaluations", "My Evaluations", "clipboard", 6)
    nav_item("executive", "myself", "My Performance", "target", 7)

    nav_item("director", "team", "My Team", "users", 1)
    nav_item("director", "directorate_plans", "Directorate Plans", "clipboard", 2)
    nav_item("director", "strategic_goals", "Strategic Goals", "target", 3)
    nav_item("director", "programs", "Programs", "briefcase", 4)
    nav_item("director", "approvals", "Approvals", "shield", 5)
    nav_item("director", "evaluations", "My Evaluations", "clipboard", 6)
    nav_item("director", "myself", "My Performance", "target", 7)

    nav_item("dept_head", "team", "My Team", "users", 1)
    nav_item("dept_head", "department_plans", "Department Plans", "clipboard", 2)
    nav_item("dept_head", "programs", "Programs", "briefcase", 3)
    nav_item("dept_head", "approvals", "Approvals", "shield", 4)
    nav_item("dept_head", "evaluations", "My Evaluations", "clipboard", 5)
    nav_item("dept_head", "myself", "My Performance", "target", 6)

    nav_item("team_leader", "team", "My Team", "users", 1)
    nav_item("team_leader", "team_plans", "Team Plans", "clipboard", 2)
    nav_item("team_leader", "weekly_tasks", "Weekly Tasks", "calendar", 3)
    nav_item("team_leader", "programs", "Programs", "briefcase", 4)
    nav_item("team_leader", "peer_reviews", "Peer Reviews", "users", 5)
    nav_item("team_leader", "approvals", "Approvals", "shield", 6)
    nav_item("team_leader", "evaluations", "My Evaluations", "clipboard", 7)
    nav_item("team_leader", "myself", "My Performance", "target", 8)

    nav_item("manager", "team", "My Team", "users", 1)
    nav_item("manager", "programs", "Programs", "briefcase", 2)
    nav_item("manager", "approvals", "Approvals", "shield", 3)
    nav_item("manager", "evaluations", "My Evaluations", "clipboard", 4)
    nav_item("manager", "myself", "My Performance", "target", 5)

    nav_item("employee", "home", "Home", "dashboard", 0)
    nav_item("employee", "weekly_tasks", "Weekly Tasks", "calendar", 1)
    nav_item("employee", "programs", "Programs", "briefcase", 2)
    nav_item("employee", "peer_reviews", "Peer Reviews", "users", 3)
    nav_item("employee", "evaluations", "My Evaluations", "clipboard", 4)
    nav_item("employee", "myself", "My Performance", "target", 5)

    # ---------------- Sample strategic goals (cascading cascade) ----------------
    def strategic_goal(title, scope, owner_id=None, assigned_to_id=None, org_unit_id=None,
                       parent_id=None, description="", status="active", progress=0, quarter="Q1", year=2026):
        db.execute(
            "INSERT INTO strategic_goals (parent_id, title, description, scope, owner_id, assigned_to_id, "
            "org_unit_id, cycle_id, quarter, year, status, progress_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (parent_id, title, description, scope, owner_id, assigned_to_id, org_unit_id,
             cycle_id, quarter, year, status, progress),
        )
        return db.execute("SELECT id FROM strategic_goals WHERE title=? ORDER BY id DESC", (title,)).fetchone()["id"]

    sg_annual = strategic_goal(
        "Strengthen national environmental stewardship through improved compliance & climate action",
        "annual", owner_id=lelise_id, description="Authority-wide annual strategic direction for 2026.")

    sg_q_reg = strategic_goal(
        "Raise ESIA review throughput while preserving quality", "quarterly",
        owner_id=tesfaye_id, assigned_to_id=tesfaye_id, org_unit_id=regulatory_id, parent_id=sg_annual,
        description="Directorate-level quarterly goal under the annual direction.", progress=40)

    sg_q_climate = strategic_goal(
        "Deliver the 2026 GHG inventory with MRV data confidence", "quarterly",
        owner_id=hirut_id, assigned_to_id=hirut_id, org_unit_id=climate_id, parent_id=sg_annual,
        description="Climate Change Response quarterly goal.", progress=60)

    sg_team_esia = strategic_goal(
        "Reduce median ESIA review cycle by 20%", "team",
        owner_id=tesfaye_id, assigned_to_id=solomon_id, org_unit_id=esia_review_id, parent_id=sg_q_reg,
        description="ESIA Review Team target for the quarter.", progress=50)

    sg_team_mrv = strategic_goal(
        "Complete the 2026 GHG inventory data collection", "team",
        owner_id=hirut_id, assigned_to_id=endalk_id, org_unit_id=mrv_id, parent_id=sg_q_climate,
        description="MRV & Reporting Team target for the quarter.", progress=70)

    sg_backlog = strategic_goal(
        "Clear the national ESIA backlog", "individual",
        owner_id=solomon_id, assigned_to_id=dawit_id, org_unit_id=esia_review_id, parent_id=sg_team_esia,
        description="Individual target: clear 40 pending reviews by end of Q1.", status="active", progress=35)

    sg_ghg = strategic_goal(
        "Complete the GHG inventory submission", "individual",
        owner_id=endalk_id, assigned_to_id=bereket_id, org_unit_id=mrv_id, parent_id=sg_team_mrv,
        description="Individual target: submit verified inventory to UNFCCC.", status="active", progress=70)

    # ---------------- Sample weekly plans ----------------
    def _week_bounds():
        from datetime import date, timedelta
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        return monday.strftime("%Y-%m-%d"), (monday + timedelta(days=4)).strftime("%Y-%m-%d")

    def weekly_plan(emp_id, tasks):
        wb = _week_bounds()
        db.execute(
            "INSERT INTO weekly_plans (employee_id, week_start, week_end) VALUES (?,?,?)",
            (emp_id, wb[0], wb[1]),
        )
        plan_id = db.execute(
            "SELECT id FROM weekly_plans WHERE employee_id=? ORDER BY id DESC", (emp_id,)).fetchone()["id"]
        for order, (title, status, goal_id, day) in enumerate(tasks):
            db.execute(
                "INSERT INTO weekly_tasks (plan_id, title, status, strategic_goal_id, sort_order, day_of_week) "
                "VALUES (?,?,?,?,?,?)",
                (plan_id, title, status, goal_id, order, day))
        return plan_id

    weekly_plan(dawit_id, [
        ("Draft ESIA review for Yohannes Cement plant", "done", None, 1),
        ("Attend stakeholder consultation for the Addis ring road", "done", None, 2),
        ("Clear 3 pending ESIA applications from the backlog", "in_progress", sg_backlog, 3),
        ("Update review tracker", "todo", None, 4),
    ])
    weekly_plan(fatuma_id, [
        ("Scheduled industrial compliance inspection (Bole Lemi zone)", "done", None, 1),
        ("Prepare violation citation for ABC Textiles", "in_progress", None, 2),
        ("Submit weekly inspection report", "done", None, 5),
    ])
    weekly_plan(bereket_id, [
        ("Compile 2026 GHG activity data", "done", sg_ghg, 1),
        ("Run MRV data quality checks", "done", sg_ghg, 2),
        ("Draft inventory methodology annex", "in_progress", sg_ghg, 3),
        ("Coordinate with regional bureaus on data gaps", "todo", sg_ghg, 4),
    ])
    weekly_plan(sara_id, [
        ("Patch identity-server critical vulnerability", "done", None, 2),
        ("Migrate shared drive to cloud storage", "todo", None, 4),
        ("Weekly help desk triage", "done", None, 5),
    ])

    db.commit()
    db.close()
    print("Seed complete.")
    print(f"Login accounts (password: {DEMO_PASSWORD}): admin1, exec1, director1, director2, depthead1, lead1, lead2, lead3, employee1, employee2, employee3, employee4")


if __name__ == "__main__":
    run()
