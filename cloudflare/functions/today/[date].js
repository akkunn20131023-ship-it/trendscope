import { todayPage } from "../../lib/todaypage.js";
export const onRequestGet = ({ request, env, params }) => todayPage(request, env, params.date);
