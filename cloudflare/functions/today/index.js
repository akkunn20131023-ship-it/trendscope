import { todayPage } from "../../lib/todaypage.js";
export const onRequestGet = ({ request, env }) => todayPage(request, env, null);
