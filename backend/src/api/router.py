from fastapi import APIRouter

from src.modules.activities.router import router as activities_router
from src.modules.activity_feed.router import router as activity_feed_router
from src.modules.projects.router import router as projects_router
from src.modules.agreements.router import approvals_router as agreement_approvals_router
from src.modules.agreements.router import router as agreements_router
from src.modules.app_config.router import router as app_config_router
from src.modules.dashboard.router import router as dashboard_router
from src.modules.share.router import router as share_router
from src.modules.orders.router import router as orders_router
from src.modules.reports.router import router as reports_router
from src.modules.samples.router import router as samples_router
from src.modules.auth.router import router as auth_router
from src.modules.banners.router import router as banners_router
from src.modules.gifting_requests.oms_router import router as oms_router
from src.modules.gifting_requests.router import clients_router as gifting_clients_router
from src.modules.gifting_requests.router import planning_router as gifting_planning_router
from src.modules.gifting_requests.router import router as gifting_requests_router
from src.modules.integrations.router import router as integrations_router
from src.modules.people.router import router as people_router
from src.modules.clients.router import router as clients_router
from src.modules.deal.router import router as deal_router
from src.modules.imports.router import router as imports_router
from src.modules.leads.router import router as leads_router
from src.modules.minutes.router import router as minutes_router
from src.modules.meetings.router import router as meetings_router
from src.modules.notifications.router import router as notifications_router
from src.modules.payments.router import router as payments_router
from src.modules.quotations.router import router as quotations_router
from src.modules.stages.router import router as stages_router
from src.modules.targets.router import router as targets_router
from src.modules.tasks.router import router as tasks_router
from src.modules.team.router import router as team_router
from src.modules.users.router import router as users_router
from src.modules.whatsapp.router import router as whatsapp_router
from src.modules.os_modules.router import router as os_modules_router

api_router = APIRouter()

# Public / pre-context routes
api_router.include_router(auth_router)
# Server to server (TOFAA Gifting OS): an API key, not a signed-in person
api_router.include_router(integrations_router)

# Feature routes
api_router.include_router(users_router)
api_router.include_router(people_router)  # KAM and admin
api_router.include_router(os_modules_router)  # KAM, sales manager and admin
api_router.include_router(banners_router)  # KAM and admin
api_router.include_router(gifting_requests_router)  # KAM and admin
api_router.include_router(gifting_planning_router)  # KAM and admin
api_router.include_router(gifting_clients_router)  # KAM and admin
api_router.include_router(oms_router)  # called by OMS, signed
api_router.include_router(leads_router)
api_router.include_router(activities_router)
api_router.include_router(tasks_router)
api_router.include_router(meetings_router)
api_router.include_router(whatsapp_router)
api_router.include_router(imports_router)
api_router.include_router(notifications_router)
api_router.include_router(stages_router)
api_router.include_router(quotations_router)
api_router.include_router(minutes_router)
api_router.include_router(agreements_router)
api_router.include_router(agreement_approvals_router)
api_router.include_router(app_config_router)
api_router.include_router(orders_router)
api_router.include_router(dashboard_router)
api_router.include_router(share_router)
api_router.include_router(reports_router)
api_router.include_router(samples_router)
api_router.include_router(payments_router)
api_router.include_router(deal_router)
api_router.include_router(clients_router)
api_router.include_router(activity_feed_router)
api_router.include_router(projects_router)
api_router.include_router(team_router)
api_router.include_router(targets_router)
