<?php
/*
 * Plugin Name: PayChangu Payment Gateway for WooCommerce
 * Plugin URI: https://paychangu.com
 * Description: PayChangu Payment Gateway for WooCommerce
 * Author: PayChangu
 * Author URI: https://profiles.wordpress.org/paychangultd
 * Version: 1.2.0
 * License: GPLv3
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 */

use Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'PAYCHANGU_GATEWAY_VERSION', '1.2.0' );
define( 'PAYCHANGU_GATEWAY_URL', untrailingslashit( plugins_url( basename( plugin_dir_path( __FILE__ ) ), basename( __FILE__ ) ) ) );
define( 'PAYCHANGU_GATEWAY_PATH', untrailingslashit( plugin_dir_path( __FILE__ ) ) );

/*
 * This action hook registers our PHP class as a WooCommerce payment gateway
 */
add_filter( 'woocommerce_payment_gateways', 'paychangu_add_gateway_class' );
function paychangu_add_gateway_class( $gateways ) {
	$gateways[] = 'Paychangu_Gateway'; // your class name is here
	return $gateways;
}

add_action( 'woocommerce_blocks_loaded', 'paychangu_woocommerce_blocks_support' );
function paychangu_woocommerce_blocks_support() {
	if ( class_exists( 'Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType' ) ) {
		require_once dirname( __FILE__ ) . '/includes/class-wc-gateway-paychangu-blocks-support.php';
		add_action(
			'woocommerce_blocks_payment_method_type_registration',
			function( Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $payment_method_registry ) {
				$payment_method_registry->register( new Paychangu_Blocks_Support );
			}
		);
	}
}

/*
 * The class itself, please note that it is inside plugins_loaded action hook
 */
add_action( 'plugins_loaded', 'paychangu_init_gateway_class' );
function paychangu_init_gateway_class() {
    if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
		return;
	}
    
    require_once dirname( __FILE__ ) . '/includes/class-wc-paychangu-gateway.php';
}

/**
* Add Paychangu Gateway to WC
**/
function paychangu_add_gateway_to_woocommerce( $methods ) {
    $methods[] = 'Paychangu_Gateway';
	return $methods;
}

/**
* Add Settings link to the plugin entry in the plugins menu
**/
function paychangu_plugin_action_links( $links ) {
    $settings_link = array(
    	'settings' => '<a href="' . admin_url( 'admin.php?page=wc-settings&tab=checkout&section=paychangu' ) . '" title="View Settings">Settings</a>'
    );
    return array_merge( $settings_link, $links );
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'paychangu_plugin_action_links' );